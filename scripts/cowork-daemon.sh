#!/usr/bin/env bash
#
# cowork-daemon.sh
#   docs/requests/ への書き込みを検知して、ヘッドレスの Claude Code
#   （claude -p "/cowork-check"）を直接起動する常駐プロセス。
#
#   SessionStart フックから cowork-hook-start.sh 経由で起動され、
#   SessionEnd フックから cowork-hook-stop.sh で止められる。
#
#   fswatch などの追加インストールは不要。POLL_SEC ごとに docs/requests/ の
#   ハッシュを取り直して見比べるだけのポーリング方式にしてある。
#
#   手動で動かす場合:
#     nohup bash scripts/cowork-daemon.sh manual >/dev/null 2>&1 &
#
set -uo pipefail

OWNER="${1:-unknown}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WATCH_DIR="$ROOT/docs/requests"
STATE_DIR="$ROOT/.cowork"
LOG="$STATE_DIR/daemon.log"
PIDFILE="$STATE_DIR/daemon.pid"
SESSFILE="$STATE_DIR/sessions.tsv"

# ---- 調整できる値 -------------------------------------------------------
# ヘッドレス実行の権限モード。
#   acceptEdits       … ファイル編集は自動承認、シェルは allow リストの範囲だけ（既定・安全側）
#   bypassPermissions … 全部無条件に実行（止まらないが、何でもできてしまう）
PERMISSION_MODE='acceptEdits'
POLL_SEC=5          # 見に行く間隔
DEBOUNCE_SEC=6      # 書き込みが止んでから起動するまでの待ち
COOLDOWN_SEC=45     # 1回走った後、次を受け付けるまでの休み
MAX_RUNS_PER_HOUR=6 # 暴走よけの上限
IDLE_EXIT_MIN=60    # ウィンドウが1枚も無い状態がこれだけ続いたら自分で終了
# ------------------------------------------------------------------------

mkdir -p "$STATE_DIR" "$WATCH_DIR"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

# ---- 多重起動の防止 -----------------------------------------------------
# 常駐はマシンに1つだけ。生きている PID が居たら何もせず降りる。
if [ -f "$PIDFILE" ]; then
  old_pid="$(head -1 "$PIDFILE" 2>/dev/null | cut -f1)"
  if [ -n "${old_pid:-}" ] && kill -0 "$old_pid" 2>/dev/null; then
    log "既に PID $old_pid が動いているので起動しない"
    exit 0
  fi
  log "古い daemon.pid（PID ${old_pid:-?}）が残っていたので引き継ぐ"
fi
printf '%s\t%s\t%s\n' "$$" "$OWNER" "$(date '+%Y-%m-%dT%H:%M:%S%z')" > "$PIDFILE"

cleanup() {
  log "停止しました（PID $$）"
  if [ -f "$PIDFILE" ] && [ "$(head -1 "$PIDFILE" | cut -f1)" = "$$" ]; then
    rm -f "$PIDFILE"
  fi
}
trap cleanup EXIT INT TERM

log "起動しました（PID $$ / owner=$OWNER / 権限モード=$PERMISSION_MODE / 監視=docs/requests）"

# ---- 監視対象のいまの姿を1つの文字列にまとめる --------------------------
# 中身が変わっても名前が変わっても、この値が変わる。
tree_hash() {
  find "$WATCH_DIR" -type f ! -name '.DS_Store' -print0 2>/dev/null \
    | LC_ALL=C sort -z \
    | while IFS= read -r -d '' f; do
        printf '%s %s\n' "$(shasum -a 1 "$f" | cut -d' ' -f1)" "${f#"$ROOT"/}"
      done | shasum -a 1 | cut -d' ' -f1
}

# ---- 開いているウィンドウが1枚でも生きているか --------------------------
any_window_alive() {
  [ -f "$SESSFILE" ] || return 1
  while IFS="$(printf '\t')" read -r _sid spid _since; do
    if [ -n "${spid:-}" ] && kill -0 "$spid" 2>/dev/null; then
      return 0
    fi
  done < "$SESSFILE"
  return 1
}

# ---- ヘッドレス実行 -----------------------------------------------------
run_check() {
  paths_note="$1"

  # 直近1時間の実行回数で頭打ちにする
  now="$(date +%s)"
  cutoff=$((now - 3600))
  kept=""
  for t in $RUN_TIMES; do
    [ "$t" -gt "$cutoff" ] && kept="$kept $t"
  done
  RUN_TIMES="$kept"

  count=0
  for t in $RUN_TIMES; do count=$((count + 1)); done
  if [ "$count" -ge "$MAX_RUNS_PER_HOUR" ]; then
    log "1時間あたりの上限 $MAX_RUNS_PER_HOUR 回に達したので今回は起動しない（$paths_note）"
    return
  fi
  RUN_TIMES="$RUN_TIMES $now"

  log "検知 → claude -p '/cowork-check' を起動（$paths_note）"

  # ヘッドレス実行は「開いているウィンドウ」ではない。フック側が登録／解除しないよう目印を渡す
  # （これが無いと、実行が終わった瞬間に「最後の1枚が閉じた」と誤判定して常駐が自滅する）
  (
    cd "$ROOT" || exit 1
    COWORK_HEADLESS=1 claude -p "/cowork-check" --permission-mode "$PERMISSION_MODE" \
      < /dev/null > "$STATE_DIR/headless-out.txt" 2> "$STATE_DIR/headless-err.txt"
  )
  exit_code=$?

  tail_out="$(cat "$STATE_DIR/headless-out.txt" "$STATE_DIR/headless-err.txt" 2>/dev/null | tail -c 2000)"
  [ -n "$tail_out" ] && log "ヘッドレス実行の出力（末尾）: $tail_out"
  log "ヘッドレス実行が終了しました（exit=$exit_code）"
}

# ---- 本体 ---------------------------------------------------------------
LAST_HASH="$(tree_hash)"
PENDING=0
LAST_CHANGE=0
LAST_RUN=$(( $(date +%s) - COOLDOWN_SEC ))
RUN_TIMES=""
NO_WINDOW_SINCE=0
LAST_SESS_CHECK=$(date +%s)
LAST_ALIVE_LOG=$(date +%s)

while true; do
  sleep "$POLL_SEC"
  now="$(date +%s)"

  h="$(tree_hash)"
  if [ "$h" != "$LAST_HASH" ]; then
    LAST_HASH="$h"
    PENDING=1
    LAST_CHANGE="$now"
  fi

  # 1時間ごとに生存を書き残す（黙って落ちたのを後から見つけられるように）
  if [ $((now - LAST_ALIVE_LOG)) -ge 3600 ]; then
    LAST_ALIVE_LOG="$now"
    log "稼働中（PID $$）"
  fi

  # 1分おきに「まだウィンドウが開いているか」を見る。一定時間ゼロなら自分で終了する
  if [ $((now - LAST_SESS_CHECK)) -ge 60 ]; then
    LAST_SESS_CHECK="$now"
    if any_window_alive; then
      NO_WINDOW_SINCE=0
    else
      if [ "$NO_WINDOW_SINCE" = 0 ]; then
        NO_WINDOW_SINCE="$now"
      elif [ $((now - NO_WINDOW_SINCE)) -ge $((IDLE_EXIT_MIN * 60)) ]; then
        log "Claude Code のウィンドウが ${IDLE_EXIT_MIN} 分間ひとつも無いため、自分で終了します"
        break
      fi
    fi
  fi

  if [ "$PENDING" = 1 ]; then
    quiet=$((now - LAST_CHANGE))
    since_run=$((now - LAST_RUN))
    if [ "$quiet" -ge "$DEBOUNCE_SEC" ] && [ "$since_run" -ge "$COOLDOWN_SEC" ]; then
      PENDING=0
      run_check "docs/requests に変更"
      LAST_RUN="$(date +%s)"
    fi
  fi
done
