#!/usr/bin/env bash
# 修正を本番に出すまでを1コマンドで行う(作業場所の中で、変更をコミットしたあとに)。
#
#   bash scripts/ship.sh "<何を直したか>" [--done <要望のid>] [--from <依頼が来た時刻 epoch 秒>] [--changelog <ファイル>] [--size <大きさ>] [--shots] [--keep] [--dry-run] [--push-branch]
#
# やること(todoアプリ/CLAUDE.md の「本番反映」と同じ条件。1つでも落ちたら main に入れずに止まる):
#   1. 手元の main が公開の main と同じか確かめる(違えば止まる)。ブランチが main に追いついていなければ main を取り込む
#   2. 型チェックと全テストを**同時に**走らせる(同じ内容の事前の確認 scripts/preflight.sh が済んでいれば、それを使って待たない)
#   3. main へ統合 → main をプッシュ(強制プッシュはしない)。作業ブランチは**プッシュしない**(--push-branch で送る):
#      プッシュするたびに Vercel の待ち行列に1件入り、本番のビルドを待たせるため(2026-10-13 の夜、27分待った)。
#      作業の履歴は main への統合でそのまま入るので、失われない
#   4. 手元の main を進める
#   5. Vercel が公開するのを待つ(/version.json)。「Git information retrieval failed」で落ちていたら、1回だけ作り直す
#   6. Netlify の状態を見る
#   7. --done なら要望を対応済みに(**Vercel で新しい版を確かめた時だけ**。確かめられなければ「対応中」のまま)、--shots ならスクショを裏で撮り直す、最後に作業場所を片付ける(--keep で残す)
set -euo pipefail

MSG="${1:?何を直したか(統合のメッセージ)を渡してください}"
shift || true
DONE_ID=""; SHOTS=0; KEEP=0; DRY=0; PUSH_BRANCH=0; FROM_EPOCH=""; CHANGELOG_FILE=""; SIZE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --done) DONE_ID="${2:?--done の後に要望のid}"; shift 2 ;;
    --shots) SHOTS=1; shift ;;
    --from) FROM_EPOCH="${2:?--from の後に、依頼が来た時刻(epoch 秒。date +%s)}"; shift 2 ;;
    --changelog) CHANGELOG_FILE="${2:?--changelog の後に、area/title/description を書いたファイル}"; shift 2 ;;
    --size) SIZE="${2:?--size の後に、内容の大きさ(出し直し/小/中/広い見た目/大/道具)}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --push-branch) PUSH_BRANCH=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "知らない指定です: $1" >&2; exit 2 ;;
  esac
done

START=$SECONDS
E_START=$(date +%s)
# 止まった時は、.fix-times.log に「失敗」の行を残す(何回やり直したかを、あとで数えられるように)。
die() {
  echo "✗ $*" >&2
  if [ "${DRY:-0}" -eq 0 ] && [ -n "${MAIN_DIR:-}" ]; then
    printf '%s\t失敗\t-\t%s\t-\t-\t%s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$((SECONDS - START))" "${MSG}(失敗: $*)" >> "$MAIN_DIR/.fix-times.log" 2>/dev/null || true
  fi
  exit 1
}
step() { echo "▶ $*  (+$((SECONDS - START))秒)"; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" != "HEAD" ] && [ "$BRANCH" != "main" ] || die "作業ブランチの中で実行してください(いまは $BRANCH)"
WT="$(git rev-parse --show-toplevel)"
MAIN_DIR="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"
# 部品(要望を対応済みにするのは、本番で新しい版を確かめた時だけ。試験できるよう別ファイル)。
# shellcheck source=scripts/ship-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/ship-lib.sh"
SITE_URL="${SHIP_SITE_URL:-https://life-hub-dashboard.vercel.app}"
NETLIFY_SITE_ID="${SHIP_NETLIFY_SITE_ID:-cda189e4-fff5-470b-afbb-42664f5507fb}"
COAUTHOR="${SHIP_COAUTHOR:-Claude Sonnet 5.5 <noreply@anthropic.com>}"

[ -z "$(git status --porcelain --untracked-files=no)" ] || die "コミットされていない変更があります。先にコミットしてください"

step "1/6 公開の main と手元の main を見比べる"
REMOTE_MAIN="$(git ls-remote origin refs/heads/main 2>/dev/null | cut -f1)"
[ -n "$REMOTE_MAIN" ] || die "公開の main を読めませんでした(通信を確かめてください)"
[ "$(git rev-parse main)" = "$REMOTE_MAIN" ] || die "手元の main が公開の main と違います(手元 $(git rev-parse --short main) / 公開 ${REMOTE_MAIN:0:7})。手元の main を進めてから"
git merge-base --is-ancestor main HEAD || { step "ブランチが main に追いついていないので、main を取り込む"; git merge -q --no-edit main || die "main の取り込みで衝突しました"; }

# 更新履歴は、main を取り込んだあとに道具で足す(手で書き換えると、近い時間の別の修正と同じ場所で衝突する。2026-10-13)。
if [ -n "$CHANGELOG_FILE" ]; then
  [ -f "$CHANGELOG_FILE" ] || die "--changelog のファイルがありません: $CHANGELOG_FILE"
  CL_OUT="$(node scripts/changelog-add.mjs "$CHANGELOG_FILE")" || die "更新履歴を足せませんでした: $CL_OUT"
  echo "   $CL_OUT"
  # 事前の確認(scripts/preflight.sh --changelog)が、もう足してコミットしてあれば、変更は無い(二重に足さない)。
  git add src/lib/changelog.ts
  git diff --cached --quiet || git commit -q -m "更新履歴: $MSG

Co-Authored-By: $COAUTHOR"
fi

step "2/6 型チェックと全テストを同時に走らせる"
# 同じ内容(同じ木)の確認が、もう済んでいるか・走っている最中なら、それを使う(scripts/preflight.sh。2026-10-14)。
# 実画面の確認と重ねて、先に走らせておけるので、ここで待たなくて済む。内容が変わっていれば、いつもどおり走らせる。
TREE="$(git rev-parse 'HEAD^{tree}')"
if preflight_reuse "$TREE"; then
  echo "   ✓ 同じ内容の事前の確認(型チェックと全テスト)が通っています。待たずに進みます"
else
  run_checks || die "$CHECK_FAIL"
fi
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
# 2026-10-21 から、Netlify は通知の関数(netlify/functions)・netlify.toml・package.json が変わった時だけ出す(netlify.toml の ignore)。
if git -C "$MAIN_DIR" diff --quiet "$SHA^1" "$SHA" -- netlify/functions netlify.toml package.json 2>/dev/null; then
  echo "Netlify: 出さない(通知の関数は変わっていない。netlify.toml の ignore)"
  NETLIFY="出さない"
fi
if [ "$NETLIFY" != "出さない" ]; then
  OUT="$(cd "$MAIN_DIR" && npx netlify api listSiteDeploys --data "{\"site_id\":\"$NETLIFY_SITE_ID\",\"per_page\":1}" 2>/dev/null || true)"
  if echo "$OUT" | grep -q "${SHA:0:7}"; then
    NETLIFY="$(echo "$OUT" | grep -m1 '"state"' | sed 's/.*"state": "\(.*\)".*/\1/')"
  fi
  echo "Netlify: $NETLIFY"
fi

finish_feedback "$LIVE" "$DONE_ID" "$MAIN_DIR"
if [ "$SHOTS" -eq 1 ] && [ -x "$MAIN_DIR/../scripts/lifehub-shots.sh" ]; then
  # 低い優先度(nice)で走らせる。撮っている間も、次の測定やテストを遅くしないように(2026-10-13)。一連の修正の最後の1回だけ付けること。
  nohup nice -n 19 bash "$MAIN_DIR/../scripts/lifehub-shots.sh" >/dev/null 2>&1 &
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
  # 8列目は内容の大きさ(修正の見積もりの材料。scripts/estimate-fix.mjs)。付けなければ空。
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "${SHA:0:7}" "${W0:--}" "$A" "$B" "$TOTAL" "$MSG" "$SIZE" >> "$MAIN_DIR/.fix-times.log" || true
fi
echo "完了: ${SHA:0:7}  Vercel=$([ "$LIVE" -eq 1 ] && echo 公開済み || echo 未確認)  Netlify=$NETLIFY  所要 $((SECONDS - START))秒"
[ "$LIVE" -eq 1 ]
