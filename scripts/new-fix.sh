#!/usr/bin/env bash
# 修正用の作業場所(git worktree)を1コマンドで作る。
#
#   bash scripts/new-fix.sh <名前>        → 作業場所のパスを最後の行に出す(ブランチ名は fix/<名前>)
#
# 別の作業場所で作業するのは、Cowork の裏実行が同じフォルダで走って作業中のファイルを書き換えるのを避けるため
# (todoアプリ/CLAUDE.md)。node_modules と .env は本体のものを指す(入れ直さない)。
# 出す時は、その作業場所の中で `bash scripts/ship.sh "<統合のメッセージ>"`。
set -euo pipefail

NAME="${1:?名前を付けてください(例: bash scripts/new-fix.sh phone-hyphen)}"
MAIN_DIR="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"
SP="${FIX_WORKTREE_ROOT:-${TMPDIR:-/tmp}/lifehub-fixes}"
DIR="$SP/$NAME"
BRANCH="fix/$NAME"

mkdir -p "$SP"
# fetch は壊れている(todoアプリの .git に衝突コピーがある)ので使わない。手元の main を土台にする
# (出すたびに ship.sh が手元の main を最新へ進めている)。
git -C "$MAIN_DIR" worktree add -q -b "$BRANCH" "$DIR" main
ln -s "$MAIN_DIR/node_modules" "$DIR/node_modules"
[ -e "$MAIN_DIR/.env" ] && ln -s "$MAIN_DIR/.env" "$DIR/.env"
echo "$DIR"
