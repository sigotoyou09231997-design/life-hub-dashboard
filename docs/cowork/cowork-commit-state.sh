#!/usr/bin/env bash
#
# cowork-commit-state.sh — Cowork の状態ファイル（記録として残す3つ）だけをコミットする
#
#   ★ここは置き場所ではありません。ワークスペースの scripts/ へ移してください。
#
#     mv "$HOME/Desktop/WEBアプリ用/todoアプリ/docs/cowork/cowork-commit-state.sh" \
#        "$HOME/Desktop/WEBアプリ用/scripts/cowork-commit-state.sh"
#     chmod +x "$HOME/Desktop/WEBアプリ用/scripts/cowork-commit-state.sh"
#
#   なぜここに置いてあるか: 裏（無人）実行は `--add-dir` で渡された
#   「アプリのフォルダ」と「.cowork/apps/<アプリ名>/」の2か所にしか書けず、
#   scripts/ には新しいファイルを作れないため（詳しくは docs/cowork/README.md）。
#
#   使い方（移したあと）:
#     bash ../scripts/cowork-commit-state.sh todoアプリ
#     bash ../scripts/cowork-commit-state.sh todoアプリ -m "やりかけを更新"
#     bash ../scripts/cowork-commit-state.sh --all
#     bash ../scripts/cowork-commit-state.sh todoアプリ --no-push
#
#   なぜスクリプトにしたか:
#     裏（無人）実行から `git -C "<ワークスペース>" add ...` の形で打つと、
#     「別ディレクトリを指定して git の書き込み系を走らせる」形になるため
#     Claude Code の安全チェック（対象フォルダの未知の git hook を走らせられるのを防ぐもの）に
#     当たって止まる。許可リストでは通せない（`git -C .. add` を広く許可すると
#     チェックの意味が無くなる）。cd と git をこの中に閉じ込めて、外からは
#     **cd もパイプも付けず単独で** 呼べば、許可リスト1行で通せる。
#     依頼: todoアプリ/docs/requests/裏実行で承認が下りない件_原因と対応.md（2026-09-05）
#
#   触るのは .cowork/apps/<アプリ名>/ の state.tsv / waiting.txt / pending.md だけ。
#   `git add -A` はしない（人の作業途中の変更を巻き込まないため）。
#   すでに index に載っている無関係な変更も、pathspec 付き commit なので巻き込まない。
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

APPS=""
MESSAGE=""
ALL=0
PUSH=1
while [ $# -gt 0 ]; do
  case "$1" in
    --all) ALL=1; shift ;;
    -m|--message) MESSAGE="${2:-}"; shift 2 ;;
    --no-push) PUSH=0; shift ;;
    --push) PUSH=1; shift ;;
    -h|--help) sed -n '2,35p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) echo "知らない指定です: $1" >&2; exit 2 ;;
    *) APPS="${APPS}$1
"; shift ;;
  esac
done

# 記録として残すのはこの3つだけ（.gitignore の方針と合わせてある）
STATE_FILES="state.tsv waiting.txt pending.md"

# macOS のファイル名は分解済み（NFD）で返ることがあり、引数で渡された合成済み（NFC）の
# 名前と文字列としては一致しない。素直に mkdir すると同じアプリの状態フォルダが
# 2つできてしまうので、**作らずに、実在するフォルダの中から探す**。
nfc() {
  printf '%s' "$1" | iconv -f UTF-8-MAC -t UTF-8 2>/dev/null || printf '%s' "$1"
}

resolve_app() {
  # 実在する .cowork/apps/<名前> を返す（見つからなければ空）
  if [ -d "$ROOT/.cowork/apps/$1" ]; then
    printf '%s\n' "$1"
    return 0
  fi
  _want="$(nfc "$1")"
  for _d in "$ROOT"/.cowork/apps/*/; do
    [ -d "$_d" ] || continue
    _n="$(basename "$_d")"
    if [ "$(nfc "$_n")" = "$_want" ]; then
      printf '%s\n' "$_n"
      return 0
    fi
  done
  return 1
}

if [ "$ALL" = "1" ]; then
  APPS=""
  for d in "$ROOT"/.cowork/apps/*/; do
    [ -d "$d" ] || continue
    APPS="${APPS}$(basename "$d")
"
  done
fi

if [ -z "$(printf '%s' "$APPS" | sed '/^$/d')" ]; then
  echo "アプリ名を渡してください（例: bash ../scripts/cowork-commit-state.sh todoアプリ）" >&2
  echo "全アプリぶんまとめてなら --all" >&2
  exit 2
fi

if [ ! -d "$ROOT/.git" ]; then
  # 変数のうしろが全角文字のときは必ず ${} で囲む。bash 3.2 は UTF-8 の
  # 「）」を変数名の一部として読んでしまい、unbound variable で落ちる。
  echo "ワークスペース（${ROOT}）が git リポジトリではないので、記録を残せません。" >&2
  exit 1
fi

cd "$ROOT" || exit 1

PATHS=""
NAMES=""
while IFS= read -r app; do
  [ -n "$app" ] || continue
  if ! real="$(resolve_app "$app")"; then
    echo "状態フォルダが見つかりません: .cowork/apps/$app" >&2
    exit 1
  fi
  for f in $STATE_FILES; do
    [ -f "$ROOT/.cowork/apps/$real/$f" ] || continue
    PATHS="${PATHS}.cowork/apps/$real/$f
"
  done
  NAMES="${NAMES}${NAMES:+・}$real"
done <<EOF
$(printf '%s' "$APPS" | sed '/^$/d')
EOF

if [ -z "$PATHS" ]; then
  echo "残す対象のファイルがまだありません（${NAMES}）。何もしませんでした。"
  exit 0
fi

# ファイル名に空白が入っても壊れないように、pathspec は配列で渡す（bash 3.2 で動く書き方）
OLDIFS="$IFS"
IFS='
'
set -f
# shellcheck disable=SC2206
PATHSPEC=($PATHS)
set +f
IFS="$OLDIFS"

git add -- "${PATHSPEC[@]}" || exit 1

if [ -z "$(git status --porcelain -- "${PATHSPEC[@]}")" ]; then
  echo "変更はありません（${NAMES}）。コミットはしませんでした。"
  exit 0
fi

echo "コミットする内容:"
git diff --cached --stat -- "${PATHSPEC[@]}"

if [ -z "$MESSAGE" ]; then
  MESSAGE="Cowork の状態を更新（${NAMES}）"
fi

git commit -m "$MESSAGE" -- "${PATHSPEC[@]}" || exit 1

if [ "$PUSH" = "0" ]; then
  echo "（--no-push が指定されたので push はしていません）"
  exit 0
fi

# 追いかけ先が無ければ push しない。落ちても commit は手元に残るので、
# 失敗したことだけ伝えて終わる（--force や履歴の書き換えは絶対にしない）。
if ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  echo "追いかけ先（upstream）が無いので push はしていません。"
  exit 0
fi

if git push; then
  echo "push しました。"
else
  echo "push に失敗しました（commit は手元に残っています）。手で確かめてください。" >&2
  exit 1
fi
