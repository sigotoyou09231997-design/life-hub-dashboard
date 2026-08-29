#!/usr/bin/env bash
#
# cowork-watch.sh
#   Cowork が docs/requests/ に書いた依頼ファイルを、前回「実装済み」として
#   記録した時点と比較して差分を出す。依頼ごとの着手可否も判定する。
#
#   使い方:
#     bash scripts/cowork-watch.sh            # 見るだけ
#     bash scripts/cowork-watch.sh --update   # 今回の内容を「実装済み」として記録
#
#   --update は実装＋テスト通過＋コミットが終わってから付ける。
#   読んだだけ・途中で止めた場合は付けない（付けると次回その差分が消える）。
#
#   出力は標準出力と .cowork/report.md の両方に同じものを書く。
#   macOS 標準の bash 3.2 で動く書き方にしてある（mapfile 等の bash4 機能は使わない）。
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WATCH_DIR="$ROOT/docs/requests"
STATE_DIR="$ROOT/.cowork"
STATE_FILE="$STATE_DIR/state.tsv"
REPORT="$STATE_DIR/report.md"
WAITING="$STATE_DIR/waiting.txt"

UPDATE=0
[ "${1:-}" = "--update" ] && UPDATE=1

mkdir -p "$STATE_DIR" "$WATCH_DIR"

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
CUR="$TMPD/cur"; PREV="$TMPD/prev"; OUT="$TMPD/out"

# ---------- 1. いまの内容を集める（sha1 <TAB> 相対パス） ----------
# Cowork が書くのは依頼ドキュメントだけ。src/ や dist/ はこちらの実装成果物なので見ない。
find "$WATCH_DIR" -type f ! -name '.DS_Store' ! -name 'README.md' -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do
      printf '%s\t%s\n' "$(shasum -a 1 "$f" | cut -d' ' -f1)" "${f#"$ROOT"/}"
    done | LC_ALL=C sort -t"$(printf '\t')" -k2 > "$CUR"

FIRST_RUN=0
if [ -f "$STATE_FILE" ]; then
  LC_ALL=C sort -t"$(printf '\t')" -k2 "$STATE_FILE" > "$PREV"
else
  FIRST_RUN=1
  : > "$PREV"
fi

# ---------- 2. 差分を出す ----------
# パス集合の差で NEW/DEL を、共通パスのハッシュ違いで MOD を判定する。
cut -f2 "$CUR"  | LC_ALL=C sort > "$TMPD/cur.paths"
cut -f2 "$PREV" | LC_ALL=C sort > "$TMPD/prev.paths"
LC_ALL=C comm -23 "$TMPD/cur.paths" "$TMPD/prev.paths" > "$TMPD/added"
LC_ALL=C comm -13 "$TMPD/cur.paths" "$TMPD/prev.paths" > "$TMPD/removed"
: > "$TMPD/modified"
LC_ALL=C comm -12 "$TMPD/cur.paths" "$TMPD/prev.paths" | while IFS= read -r p; do
  a="$(awk -F'\t' -v p="$p" '$2==p{print $1; exit}' "$CUR")"
  b="$(awk -F'\t' -v p="$p" '$2==p{print $1; exit}' "$PREV")"
  [ "$a" != "$b" ] && printf '%s\n' "$p"
done > "$TMPD/modified"

n_add="$(wc -l < "$TMPD/added"    | tr -d ' ')"
n_mod="$(wc -l < "$TMPD/modified" | tr -d ' ')"
n_del="$(wc -l < "$TMPD/removed"  | tr -d ' ')"

STAMP="$(date '+%Y-%m-%d %H:%M')"
{
  echo "# Cowork 検知レポート（${STAMP}）"
  echo
  echo '## 差分'
  echo
  if [ "$FIRST_RUN" = 1 ]; then
    echo "初回スキャン。監視対象 $(wc -l < "$CUR" | tr -d ' ') ファイルを検出（差分判定は次回から）。"
    while IFS="$(printf '\t')" read -r _ p; do echo "- [BASE] $p"; done < "$CUR"
  elif [ "$n_add" = 0 ] && [ "$n_mod" = 0 ] && [ "$n_del" = 0 ]; then
    echo '変更なし'
  else
    while IFS= read -r p; do [ -n "$p" ] && echo "- [NEW] $p"; done < "$TMPD/added"
    while IFS= read -r p; do [ -n "$p" ] && echo "- [MOD] $p"; done < "$TMPD/modified"
    while IFS= read -r p; do [ -n "$p" ] && echo "- [DEL] $p"; done < "$TMPD/removed"
  fi
  echo

  # ---------- 3. 保留中（ユーザーの返事待ち） ----------
  # ここに残っている依頼は触らない。定期実行が同じ提案を繰り返さないための歯止め。
  if [ -s "$WAITING" ]; then
    echo '## 保留中（ユーザーの返事待ち）'
    echo
    cat "$WAITING"
    echo
  fi

  # ---------- 4. 依頼ごとのステータス ----------
  echo '## 依頼ステータス'
  echo
  if [ ! -s "$CUR" ]; then
    echo '（依頼ファイルなし）'
  else
    echo '| 依頼 | 状態 | 最終更新 |'
    echo '|---|---|---|'
    while IFS="$(printf '\t')" read -r hash p; do
      prev_hash="$(awk -F'\t' -v p="$p" '$2==p{print $1; exit}' "$PREV")"
      if [ -z "$prev_hash" ]; then
        status='着手可（新規）'
      elif [ "$prev_hash" != "$hash" ]; then
        status='着手可（更新）'
      else
        status='実装済み'
      fi
      # waiting.txt にファイル名が出ている依頼は保留扱い（触らない）
      if [ -s "$WAITING" ] && grep -qF "$(basename "$p")" "$WAITING" 2>/dev/null; then
        status='保留中'
      fi
      mtime="$(stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$ROOT/$p" 2>/dev/null || echo '-')"
      echo "| $(basename "$p") | $status | $mtime |"
    done < "$CUR"
  fi
} > "$OUT"

cat "$OUT"
cp "$OUT" "$REPORT"

# ---------- 5. --update のときだけ確定させる ----------
if [ "$UPDATE" = 1 ]; then
  cp "$CUR" "$STATE_FILE"
  echo
  echo "（.cowork/state.tsv を更新しました — $(wc -l < "$STATE_FILE" | tr -d ' ') 件を実装済みとして記録）"
fi
