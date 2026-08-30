#!/usr/bin/env bash
#
# cowork-hook-start.sh — SessionStart フックから呼ばれる。
#
#   - このセッションを .cowork/sessions.tsv に登録する（開いているウィンドウの一覧）
#   - 常駐（cowork-daemon.sh）がまだ動いていなければ、切り離したプロセスとして起動する
#   - すぐ抜ける（フックを待たせない）
#
#   複数ウィンドウで開いても常駐は1つだけ。停止は「最後の1枚を閉じたとき」だけ
#   （cowork-hook-stop.sh が判断する）。
#
set -uo pipefail

# 常駐自身が起動したヘッドレス実行（claude -p "/cowork-check"）は「開いているウィンドウ」ではない。
# ここで登録／解除すると、ヘッドレスが終わった瞬間に「最後の1枚が閉じた」と誤判定して常駐が自滅する。
if [ "${COWORK_HEADLESS:-}" = "1" ]; then exit 0; fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT/.cowork"
PIDFILE="$STATE_DIR/daemon.pid"
SESSFILE="$STATE_DIR/sessions.tsv"
DAEMON="$ROOT/scripts/cowork-daemon.sh"

mkdir -p "$STATE_DIR"

# ---- このフックを呼んでいる claude プロセスの PID を、親をたどって特定する ----
owning_claude_pid() {
  id="$PPID"
  i=0
  while [ "$i" -lt 8 ] && [ "${id:-0}" -gt 1 ]; do
    comm="$(ps -o comm= -p "$id" 2>/dev/null)"
    case "$comm" in
      *claude*) printf '%s\n' "$id"; return 0 ;;
    esac
    id="$(ps -o ppid= -p "$id" 2>/dev/null | tr -d ' ')"
    i=$((i + 1))
  done
  # 見つからなければフックの親プロセスを使う（少なくともセッションと同時に死ぬ）
  printf '%s\n' "$PPID"
}

# ---- フックの stdin から session_id を受け取る（無くても動く） ----
SESSION_ID=""
if [ ! -t 0 ]; then
  RAW="$(cat 2>/dev/null || true)"
  case "$RAW" in
    *session_id*)
      SESSION_ID="$(printf '%s' "$RAW" \
        | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
      ;;
  esac
fi

CLAUDE_PID="$(owning_claude_pid)"
[ -n "$SESSION_ID" ] || SESSION_ID="pid-$CLAUDE_PID"

# ---- 開いているウィンドウ一覧を更新（死んでいるものと自分の古い行は捨てる） ----
TMP="$(mktemp)"
if [ -f "$SESSFILE" ]; then
  while IFS="$(printf '\t')" read -r sid spid since; do
    [ -z "${sid:-}" ] && continue
    [ "$sid" = "$SESSION_ID" ] && continue
    if [ -n "${spid:-}" ] && kill -0 "$spid" 2>/dev/null; then
      printf '%s\t%s\t%s\n' "$sid" "$spid" "$since" >> "$TMP"
    fi
  done < "$SESSFILE"
fi
printf '%s\t%s\t%s\n' "$SESSION_ID" "$CLAUDE_PID" "$(date '+%Y-%m-%dT%H:%M:%S%z')" >> "$TMP"
mv "$TMP" "$SESSFILE"
WINDOWS="$(wc -l < "$SESSFILE" | tr -d ' ')"

# ---- 前回のヘッドレス実行の結果を、まだ伝えていなければ知らせる ----
# 結果は .cowork/report.md に書かれるだけで、こちらから見に行かないと分からない。
# 「感知していない」ように見えていた原因がこれなので、セッションを開いた時に出す。
REPORT="$STATE_DIR/report.md"
SEEN="$STATE_DIR/report.seen"
UNREAD=""
if [ -f "$REPORT" ] && { [ ! -f "$SEEN" ] || [ "$REPORT" -nt "$SEEN" ]; }; then
  UNREAD="$(sed -n 's/^# Cowork 検知レポート（\(.*\)）$/\1/p' "$REPORT" | head -1)"
  DONE_COUNT="$(grep -c '| 実装済み |' "$REPORT" 2>/dev/null | tr -d ' ')"
  HOLD_COUNT="$(grep -c '| 保留中 |' "$REPORT" 2>/dev/null | tr -d ' ')"
  UNREAD="前回のCowork実行（${UNREAD:-時刻不明}）: 実装済み ${DONE_COUNT:-0}件 / 保留中 ${HOLD_COUNT:-0}件。詳細は .cowork/report.md"
  : > "$SEEN"
fi

# ---- 常駐が動いていなければ起動 ----
if [ -f "$PIDFILE" ]; then
  old_pid="$(head -1 "$PIDFILE" 2>/dev/null | cut -f1)"
  if [ -n "${old_pid:-}" ] && kill -0 "$old_pid" 2>/dev/null; then
    printf '{"systemMessage":"Cowork監視は稼働中（PID %s / 開いているウィンドウ %s）%s"}\n' \
      "$old_pid" "$WINDOWS" "${UNREAD:+ ｜ $UNREAD}"
    exit 0
  fi
fi

# daemon.pid に載っていないのに生きている常駐は、停止しきれなかった取り残し。
# そのまま起動すると2つ動いて同じ依頼を二重に処理するので、先に片付ける。
for stray in $(pgrep -f "$ROOT/scripts/cowork-daemon.sh" 2>/dev/null); do
  kill -9 "$stray" 2>/dev/null || true
  printf '%s 取り残された常駐（PID %s）を片付けてから起動します\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$stray" >> "$STATE_DIR/daemon.log"
done

# 親（＝フック）が終わっても生き残るように切り離して起動する
nohup bash "$DAEMON" "$SESSION_ID" >/dev/null 2>&1 &
disown 2>/dev/null || true

printf '{"systemMessage":"Cowork監視を起動しました（docs/requests への書き込みを検知したら /cowork-check をヘッドレス実行します）%s"}\n' "${UNREAD:+ ｜ $UNREAD}"

