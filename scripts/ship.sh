#!/usr/bin/env bash
# 修正を本番に出すまでを1コマンドで行う(作業場所の中で、変更をコミットしたあとに)。
#
#   bash scripts/ship.sh "<何を直したか>" [--done <要望のid>] [--from <依頼が来た時刻 epoch 秒>] [--shots] [--keep] [--dry-run] [--push-branch]
#
# やること(todoアプリ/CLAUDE.md の「本番反映」と同じ条件。1つでも落ちたら main に入れずに止まる):
#   1. 手元の main が公開の main と同じか確かめる(違えば止まる)。ブランチが main に追いついていなければ main を取り込む
#   2. 型チェックと全テストを**同時に**走らせる
#   3. main へ統合 → main をプッシュ(強制プッシュはしない)。作業ブランチは**プッシュしない**(--push-branch で送る):
#      プッシュするたびに Vercel の待ち行列に1件入り、本番のビルドを待たせるため(2026-10-13 の夜、27分待った)。
#      作業の履歴は main への統合でそのまま入るので、失われない
#   4. 手元の main を進める
#   5. Vercel が公開するのを待つ(/version.json)。「Git information retrieval failed」で落ちていたら、1回だけ作り直す
#   6. Netlify の状態を見る
#   7. --done なら要望を対応済みに、--shots ならスクショを裏で撮り直す、最後に作業場所を片付ける(--keep で残す)
set -euo pipefail

MSG="${1:?何を直したか(統合のメッセージ)を渡してください}"
shift || true
DONE_ID=""; SHOTS=0; KEEP=0; DRY=0; PUSH_BRANCH=0; FROM_EPOCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --done) DONE_ID="${2:?--done の後に要望のid}"; shift 2 ;;
    --shots) SHOTS=1; shift ;;
    --from) FROM_EPOCH="${2:?--from の後に、依頼が来た時刻(epoch 秒。date +%s)}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --push-branch) PUSH_BRANCH=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "知らない指定です: $1" >&2; exit 2 ;;
  esac
done

START=$SECONDS
E_START=$(date +%s)
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
# 全テストは、いつもの2個ではなく4個で走らせる(約110秒 → 約75秒。5個だと混み合って時間切れで落ちるテストが出た)。そのかわり、同時に走らせる ship.sh は1つだけにする —
# 重なると作業用プロセスが何十個にもなり、Mac 全体が止まった(2026-10-12。vitest.config.ts の説明)。順番待ちの札は、
# 10分たったら古いものとして捨てる(落ちた実行の札が残っても詰まらないように)。
LOCK_DIR="${TMPDIR:-/tmp}/lifehub-ship-tests.lock"
waited=0
until mkdir "$LOCK_DIR" 2>/dev/null; do
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then rmdir "$LOCK_DIR" 2>/dev/null || true; continue; fi
  [ "$waited" -eq 0 ] && echo "   (ほかの ship.sh がテスト中です。終わるのを待ちます)"
  waited=1; sleep 3
done
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
npx tsc --noEmit >"$LOG_DIR/tsc.log" 2>&1 & TSC_PID=$!
VITEST_MAX_FORKS="${SHIP_TEST_FORKS:-4}" npm test >"$LOG_DIR/test.log" 2>&1 & TEST_PID=$!
TSC_OK=0; TEST_OK=0
wait "$TSC_PID" || TSC_OK=1
wait "$TEST_PID" || TEST_OK=1
rmdir "$LOCK_DIR" 2>/dev/null || true
grep -E "^ +(Test Files|Tests) |^ FAIL" "$LOG_DIR/test.log" || true
if [ "$TSC_OK" -ne 0 ]; then head -30 "$LOG_DIR/tsc.log" || true; die "型チェックが落ちました。main には入れていません"; fi
# テストが全部通っても、描き終わった後に起きた未処理のエラー(Errors N errors)で終了コードが 1 になることがある。
# それも「落ちた」として止める(1 になった理由が見えるよう、該当の行を出す)。
if [ "$TEST_OK" -ne 0 ]; then
  grep -E "FAIL|×|AssertionError|Errors |Uncaught|This error originated" "$LOG_DIR/test.log" | head -20 || true
  die "テストの終了コードが 0 ではありません(全文: $LOG_DIR/test.log)。main には入れていません"
fi
rm -rf "$LOG_DIR"
[ "$DRY" -eq 0 ] || { echo "(--dry-run) 型チェックとテストが通ったので、ここで止めます。main には入れていません"; exit 0; }

step "3/6 main へ統合してプッシュ"
if [ "$PUSH_BRANCH" -eq 1 ]; then git push -q origin "$BRANCH" 2>&1 | grep -v '^remote:' || true; fi
git checkout -q --detach main
git merge -q --no-ff "$BRANCH" -m "Merge branch '$BRANCH': $MSG

Co-Authored-By: $COAUTHOR"
SHA="$(git rev-parse HEAD)"
git push origin HEAD:main 2>&1 | tail -1
E_PUSHED=$(date +%s)
step "4/6 手元の main を進める"
git -C "$MAIN_DIR" merge -q --ff-only "$SHA" || die "手元の main を進められませんでした(公開はされています: ${SHA:0:7})"

step "5/6 Vercel が公開するのを待つ"
LIVE=0; REDEPLOYED=0; NEXT_CHECK=$((SECONDS + 75)); DEADLINE=$((SECONDS + 1200))
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
  sleep 4
done
E_LIVE=$(date +%s)
[ "$LIVE" -eq 1 ] && echo "✓ Vercel に出ました: ${SHA:0:7}" || echo "✗ Vercel がまだ ${SHA:0:7} になっていません(20分待ちました)。Vercel の画面を見てください"

step "6/6 Netlify を見る(待たない。ユーザーが使うのは Vercel の方で、Netlify は定期実行の担当)"
NETLIFY="確認中(ビルドが終わるまで待たない)"
OUT="$(cd "$MAIN_DIR" && npx netlify api listSiteDeploys --data "{\"site_id\":\"$NETLIFY_SITE_ID\",\"per_page\":1}" 2>/dev/null || true)"
if echo "$OUT" | grep -q "${SHA:0:7}"; then
  NETLIFY="$(echo "$OUT" | grep -m1 '"state"' | sed 's/.*"state": "\(.*\)".*/\1/')"
fi
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
# 所要時間の計測(2026-10-13)。依頼が届いてから公開までを、3つに分けて出し、.fix-times.log(git に入れない)に残す。
#   依頼→開始 = 見つけて、調べて、直す時間(私の作業)/ テスト・統合 = ship.sh の前半 / 公開待ち = push から Vercel が公開するまで
if [ "$DRY" -eq 0 ]; then
  T0=""
  if [ -n "$FROM_EPOCH" ]; then T0="$FROM_EPOCH"
  elif [ -n "$DONE_ID" ]; then T0="$(node "$MAIN_DIR/scripts/feedback-inbox.mjs" --created "$DONE_ID" 2>/dev/null || true)"; fi
  case "$T0" in ''|*[!0-9]*) T0="" ;; esac
  A=$((E_PUSHED - E_START)); B=$((${E_LIVE:-$(date +%s)} - E_PUSHED))
  if [ -n "$T0" ]; then
    W0=$((E_START - T0)); TOTAL=$((${E_LIVE:-$(date +%s)} - T0))
    echo "計測: 依頼→開始 ${W0}秒(調べて直す) / テスト・統合 ${A}秒 / 公開待ち ${B}秒 / 依頼→公開 ${TOTAL}秒"
  else
    W0=""; TOTAL=$((${E_LIVE:-$(date +%s)} - E_START))
    echo "計測: テスト・統合 ${A}秒 / 公開待ち ${B}秒 / 開始→公開 ${TOTAL}秒(依頼の時刻が分からないので、依頼→開始は無し)"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "${SHA:0:7}" "${W0:--}" "$A" "$B" "$TOTAL" "$MSG" >> "$MAIN_DIR/.fix-times.log" || true
fi
echo "完了: ${SHA:0:7}  Vercel=$([ "$LIVE" -eq 1 ] && echo 公開済み || echo 未確認)  Netlify=$NETLIFY  所要 $((SECONDS - START))秒"
[ "$LIVE" -eq 1 ]
