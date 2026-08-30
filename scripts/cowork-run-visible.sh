#!/usr/bin/env bash
#
# cowork-run-visible.sh — 依頼の反映（claude -p "/cowork-check"）を、
#   見えるターミナルのウィンドウで走らせるための実行役。
#
#   cowork-daemon.sh が osascript 経由で Terminal.app に開かせ、その中でこれが動く。
#   常駐から直接呼ばれることは無い（常駐は終わるのを .cowork/run.exit で待つ）。
#
#   使い方: bash scripts/cowork-run-visible.sh <権限モード> <検知した内容>
#
#   何をしているか:
#     - claude を stream-json で走らせ、流れてくる出力から「いま何をしているか」の
#       行だけを取り出して表示する（-p の既定の出力は最後まで何も出ないため、
#       ウィンドウを開いても固まっているようにしか見えない）
#     - 見やすくした行は .cowork/headless-out.txt にも残す（常駐がログの末尾に使う）
#     - 生の stream-json は .cowork/headless-stream.jsonl に残す（解析用）
#     - 終了コードを .cowork/run.exit に書く（常駐はこれを見て終了を知る）
#
set -uo pipefail

MODE="${1:-acceptEdits}"
NOTE="${2:-docs/requests に変更}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT/.cowork"
OUT="$STATE_DIR/headless-out.txt"
ERR="$STATE_DIR/headless-err.txt"
STREAM="$STATE_DIR/headless-stream.jsonl"
EXITFILE="$STATE_DIR/run.exit"
RUNPID="$STATE_DIR/run.pid"

mkdir -p "$STATE_DIR"
cd "$ROOT" || exit 1

rm -f "$EXITFILE"
printf '%s\n' "$$" > "$RUNPID"

printf '\033]0;Cowork — 依頼を反映中\007'
printf '\n'
printf '  Cowork\n'
printf '  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
printf '  %s を見つけたので、/cowork-check を走らせます（権限モード: %s）\n' "$NOTE" "$MODE"
printf '  このウィンドウは見ているだけで大丈夫です。閉じると途中で止まります。\n'
printf '  ------------------------------------------------------------\n\n'

# 流れてくる stream-json から、進み具合として意味のある行だけを拾う。
#   - assistant の文章 … いま何をしようとしているか
#   - ツールの名前     … Edit / Bash / Read など、実際に手を動かしたところ
#   - result           … 最後のまとめ
# 形が変わって何も拾えなくなっても「止まっている」と見えないよう、
# 一定行ごとに点を打って動いていることは分かるようにしておく。
format_stream() {
  awk '
    function unesc(s) {
      gsub(/\\n/, "\n      ", s); gsub(/\\t/, " ", s)
      gsub(/\\"/, "\"", s); gsub(/\\\\/, "\\", s)
      return s
    }
    {
      shown = 0
      line = $0

      if (match(line, /"type"[ ]*:[ ]*"result"/)) {
        if (match(line, /"result"[ ]*:[ ]*"/)) {
          rest = substr(line, RSTART + RLENGTH)
          if (match(rest, /"[ ]*,/)) rest = substr(rest, 1, RSTART - 1)
          printf("\n  == 結果 ==\n  %s\n", unesc(rest))
          shown = 1
        }
      }

      # ツール呼び出し: {"type":"tool_use","name":"Edit",...}
      tail = line
      while (match(tail, /"name"[ ]*:[ ]*"[A-Za-z_][A-Za-z0-9_]*"/)) {
        piece = substr(tail, RSTART, RLENGTH)
        tail = substr(tail, RSTART + RLENGTH)
        if (match(piece, /"[A-Za-z_][A-Za-z0-9_]*"$/)) {
          name = substr(piece, RSTART + 1, RLENGTH - 2)
          if (name != "" && name != "text" && name != "result") {
            printf("  → %s\n", name)
            shown = 1
          }
        }
      }

      # 本文: {"text":"..."}
      tail = line
      while (match(tail, /"text"[ ]*:[ ]*"/)) {
        tail = substr(tail, RSTART + RLENGTH)
        rest = tail
        if (match(rest, /"[ ]*[,}]/)) rest = substr(rest, 1, RSTART - 1)
        if (length(rest) > 0) {
          printf("      %s\n", unesc(rest))
          shown = 1
        }
      }

      if (!shown) {
        dots++
        if (dots % 20 == 0) { printf("  .\n") }
      }
      fflush()
    }
  '
}

COWORK_HEADLESS=1 claude -p "/cowork-check" \
  --permission-mode "$MODE" \
  --verbose --output-format stream-json \
  < /dev/null 2> "$ERR" \
  | tee "$STREAM" \
  | format_stream | tee "$OUT"
code="${PIPESTATUS[0]}"

printf '\n  ------------------------------------------------------------\n'
if [ "$code" = 0 ]; then
  printf '  終わりました。結果は .cowork/report.md\n'
else
  printf '  途中で終わりました（exit=%s）。詳しくは .cowork/headless-err.txt\n' "$code"
fi
printf '  このウィンドウは閉じて構いません。\n\n'

printf '%s\n' "$code" > "$EXITFILE"
rm -f "$RUNPID"
exit "$code"
