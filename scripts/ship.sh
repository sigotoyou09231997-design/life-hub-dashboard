#!/usr/bin/env bash
# 修正を本番に出すまでを1コマンドで行う(作業場所の中で、変更をコミットしたあとに)。
#
#   bash scripts/ship.sh "<何を直したか>" [--done <要望のid>] [--shots] [--keep] [--dry-run]
#
# やること(todoアプリ/CLAUDE.md の「本番反映」と同じ条件。1つでも落ちたら main に入れずに止まる):
#   1. 手元の main が公開の main と同じか確かめる(違えば止まる)。ブランチが main に追いついていなければ main を取り込む
#   2. 型チェックと全テストを**同時に**走らせる
#   3. 作業ブランチをプッシュ → main へ統合 → main をプッシュ(強制プッシュはしない)
#   4. 手元の main を進める
#   5. Vercel が公開するのを待つ(/version.json)。「Git information retrieval failed」で落ちていたら、1回だけ作り直す
#   6. Netlify の状態を見る
#   7. --done なら要望を対応済みに、--shots ならスクショを裏で撮り直す、最後に作業場所を片付ける(--keep で残す)
set -euo pipefail

MSG="${1:?何を直したか(統合のメッセージ)を渡してください}"
shift || true
DONE_ID=""; SHOTS=0; KEEP=0; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --done) DONE_ID="${2:?--done の後に要望のid}"; shift 2 ;;
    --shots) SHOTS=1; shift ;;
    --keep) KEEP=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "知らない指定です: $1" >&2; exit 2 ;;
  esac
done

START=$SECONDS
die() { echo "✗ $*" >&2; exit 1; }
step() { echo "▶ $*  (+$((SECONDS - START))秒)"; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" != "HEAD" ] && [ "$BRANCH" != "main" ] || die "作業ブランチの中で実行してください(いまは $BRANCH)"
WT="$(git rev-parse --show-toplevel)"
MAIN_DIR="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"
SITE_URL="${SHIP_SITE_URL:-https://life-hub-dashboard.vercel.app}"
NETLIFY_SITE_ID="${SHIP_NETLIFY_SITE_ID:-cda189e4-fff5-470b-afbb-42664f5507fb}"
COAUTHOR="${SHIP_COAUTHOR:-Claude Sonnet 5.5 <noreply@anthropic.com>}"

[ -z "$(git status --porcelain --untracked-files=no)" ] || die "コミットされていない変更があります。先にコミットしてください"

step "1/6 公開の main と手元の main を見比べる"
REMOTE_MAIN="$(git ls-remote origin refs/heads/main 2>/dev/null | cut -f1)"
[ -n "$REMOTE_MAIN" ] || die "公開の main を読めませんでした(通信を確かめてください)"
[ "$(git rev-parse main)" = "$REMOTE_MAIN" ] || die "手元の main が公開の main と違います(手元 $(git rev-parse --short main) / 公開 ${REMOTE_MAIN:0:7})。手元の main を進めてから"
git merge-base --is-ancestor main HEAD || { step "ブランチが main に追いついていないので、main を取り込む"; git merge -q --no-edit main || die "main の取り込みで衝突しました"; }

step "2/6 型チェックと全テストを同時に走らせる"
LOG_DIR="$(mktemp -d)"
npx tsc --noEmit >"$LOG_DIR/tsc.log" 2>&1 & TSC_PID=$!
npm test >"$LOG_DIR/test.log" 2>&1 & TEST_PID=$!
TSC_OK=0; TEST_OK=0
wait "$TSC_PID" || TSC_OK=1
wait "$TEST_PID" || TEST_OK=1
grep -E "^ +(Test Files|Tests) |^ FAIL" "$LOG_DIR/test.log" || true
if [ "$TSC_OK" -ne 0 ]; then head -30 "$LOG_DIR/tsc.log"; die "型チェックが落ちました。main には入れていません"; fi
if [ "$TEST_OK" -ne 0 ]; then grep -E "FAIL|×|AssertionError" "$LOG_DIR/test.log" | head -20; die "テストが落ちました(全文: $LOG_DIR/test.log)。main には入れていません"; fi
rm -rf "$LOG_DIR"
[ "$DRY" -eq 0 ] || { echo "(--dry-run) 型チェックとテストが通ったので、ここで止めます。main には入れていません"; exit 0; }

step "3/6 プッシュして main へ統合"
git push -q origin "$BRANCH" 2>&1 | grep -v '^remote:' || true
git checkout -q --detach main
git merge -q --no-ff "$BRANCH" -m "Merge branch '$BRANCH': $MSG

Co-Authored-By: $COAUTHOR"
SHA="$(git rev-parse HEAD)"
git push origin HEAD:main 2>&1 | tail -1
step "4/6 手元の main を進める"
git -C "$MAIN_DIR" merge -q --ff-only "$SHA" || die "手元の main を進められませんでした(公開はされています: ${SHA:0:7})"

step "5/6 Vercel が公開するのを待つ"
LIVE=0; REDEPLOYED=0; NEXT_CHECK=$((SECONDS + 75)); DEADLINE=$((SECONDS + 600))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  V="$(curl -fsS "$SITE_URL/version.json?t=$RANDOM" 2>/dev/null || true)"
  case "$V" in *"${SHA:0:7}"*) LIVE=1; break ;; esac
  if [ "$REDEPLOYED" -eq 0 ] && [ "$SECONDS" -ge "$NEXT_CHECK" ]; then
    NEXT_CHECK=$((SECONDS + 40))
    ROW="$(cd "$MAIN_DIR" && npx vercel ls life-hub-dashboard 2>/dev/null | grep -m1 'Production' || true)"
    if echo "$ROW" | grep -q "Error"; then
      URL="$(echo "$ROW" | grep -o 'https://[^ ]*vercel.app' | head -1)"
      step "Vercel のビルドが落ちた(Git 情報が取れない等)ので、1回だけ作り直す: $URL"
      (cd "$MAIN_DIR" && npx vercel redeploy "$URL" --target production --no-wait >/dev/null 2>&1) || true
      REDEPLOYED=1
    fi
  fi
  sleep 8
done
[ "$LIVE" -eq 1 ] && echo "✓ Vercel に出ました: ${SHA:0:7}" || echo "✗ Vercel がまだ ${SHA:0:7} になっていません(10分待ちました)。Vercel の画面を見てください"

step "6/6 Netlify を見る"
NETLIFY="待っている"
for _ in $(seq 1 12); do
  OUT="$(cd "$MAIN_DIR" && npx netlify api listSiteDeploys --data "{\"site_id\":\"$NETLIFY_SITE_ID\",\"per_page\":1}" 2>/dev/null || true)"
  if echo "$OUT" | grep -q "${SHA:0:7}"; then
    STATE="$(echo "$OUT" | grep -m1 '"state"' | sed 's/.*"state": "\(.*\)".*/\1/')"
    NETLIFY="$STATE"; [ "$STATE" = "ready" ] || [ "$STATE" = "error" ] && break
  fi
  sleep 8
done
echo "Netlify: $NETLIFY"

[ -z "$DONE_ID" ] || node "$MAIN_DIR/scripts/feedback-inbox.mjs" --done "$DONE_ID"
if [ "$SHOTS" -eq 1 ] && [ -x "$MAIN_DIR/../scripts/lifehub-shots.sh" ]; then
  nohup bash "$MAIN_DIR/../scripts/lifehub-shots.sh" >/dev/null 2>&1 &
  echo "スクショを裏で撮り直しています(~/Desktop/LIFEHUB画面スクショ.zip)"
fi
if [ "$KEEP" -eq 0 ]; then
  cd "$MAIN_DIR"
  git worktree remove --force "$WT" 2>/dev/null || true
  git branch -D "$BRANCH" >/dev/null 2>&1 || true
fi
echo "完了: ${SHA:0:7}  Vercel=$([ "$LIVE" -eq 1 ] && echo 公開済み || echo 未確認)  Netlify=$NETLIFY  所要 $((SECONDS - START))秒"
[ "$LIVE" -eq 1 ]
