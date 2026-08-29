#!/usr/bin/env bash
#
# cowork-hook-stop.sh — SessionEnd フックから呼ばれる。
#
#   - このセッションを .cowork/sessions.tsv から外す
#   - 残ったウィンドウが1枚も無ければ、常駐（cowork-daemon.sh）を止める
#
#   まだ他のウィンドウが開いていれば常駐は止めない。ウィンドウが強制終了されて
#   このフックが飛ばなかった場合も、常駐が一定時間後に自分で終了する。
#
#   手動で止めたいとき:
#     bash scripts/cowork-hook-stop.sh --force
#
set -uo pipefail

# ヘッドレス実行（claude -p "/cowork-check"）は「開いているウィンドウ」ではないので、
# ここで解除すると最後の1枚が閉じたと誤判定して常駐が自滅する。
if [ "${COWORK_HEADLESS:-}" = "1" ]; then exit 0; fi

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT/.cowork"
PIDFILE="$STATE_DIR/daemon.pid"
SESSFILE="$STATE_DIR/sessions.tsv"

mkdir -p "$STATE_DIR"

dlog() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$STATE_DIR/daemon.log"
}

# daemon.pid に載っていない取り残しの常駐を片付ける。
# 常駐はサブシェルを作らないので、この名前で引っかかるのは常駐そのものだけ。
sweep_strays() {
  for p in $(pgrep -f "$ROOT/scripts/cowork-daemon.sh" 2>/dev/null); do
    kill -9 "$p" 2>/dev/null || true
    dlog "取り残された常駐（PID ${p}）を片付けました"
  done
}

stop_daemon() {
  dpid=""
  [ -f "$PIDFILE" ] && dpid="$(head -1 "$PIDFILE" 2>/dev/null | cut -f1)"

  if [ -n "${dpid:-}" ] && kill -0 "$dpid" 2>/dev/null; then
    kill "$dpid" 2>/dev/null || true
    dlog "Cowork監視を停止しました（PID ${dpid}）"

    # 本当に消えるまで見届ける。常駐は sleep 中に受け取るので数秒かかる。
    # ここで待たずに daemon.pid を消すと、まだ生きている常駐を残したまま
    # 次の起動が2つ目を立ち上げてしまう。
    i=0
    while [ "$i" -lt 15 ] && kill -0 "$dpid" 2>/dev/null; do
      sleep 1
      i=$((i + 1))
    done
    if kill -0 "$dpid" 2>/dev/null; then
      kill -9 "$dpid" 2>/dev/null || true
      dlog "PID $dpid が終了しなかったので強制終了しました"
    fi
  fi

  sweep_strays
  rm -f "$PIDFILE"
}

if [ "$FORCE" = 1 ]; then
  : > "$SESSFILE"
  stop_daemon
  echo "Cowork監視を停止しました。"
  exit 0
fi

# ---- フックの stdin から session_id を受け取る ----
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

# ---- 自分の行を外し、ついでに死んでいる行も掃除する ----
TMP="$(mktemp)"
if [ -f "$SESSFILE" ]; then
  while IFS="$(printf '\t')" read -r sid spid since; do
    [ -z "${sid:-}" ] && continue
    [ -n "$SESSION_ID" ] && [ "$sid" = "$SESSION_ID" ] && continue
    # session_id が取れなかった場合は、死んだプロセスの行を落とすことで自分を外す
    if [ -n "${spid:-}" ] && kill -0 "$spid" 2>/dev/null; then
      printf '%s\t%s\t%s\n' "$sid" "$spid" "$since" >> "$TMP"
    fi
  done < "$SESSFILE"
fi
mv "$TMP" "$SESSFILE"

# ---- 最後の1枚だったときだけ常駐を止める ----
if [ ! -s "$SESSFILE" ]; then
  stop_daemon
fi

exit 0
