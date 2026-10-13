#!/usr/bin/env bash
# 事前の確認: 型チェックと全テストを、書き終えた直後に裏で走らせておく(2026-10-14)。
#
#   bash scripts/preflight.sh [--changelog <ファイル> [--message "<何を直したか>"]] [--wait]
#   bash scripts/preflight.sh --status
#
# 使い方: 修正をコミットしたら、これを走らせて(すぐ戻る)、そのあいだに実画面の確認などをする。
# あとで `ship.sh` を走らせると、**同じ内容**の確認が通っていれば、テストを走らせ直さず、待たずに進む(scripts/ship-lib.sh の preflight_reuse)。
#
# 精度は下げない:
#   * 走らせるのは ship.sh と同じ run_checks(型チェックと全テスト、時間切れだけで落ちた時の単独での再実行まで)。
#   * 結果は、コミットの木(ファイルの中身全部のハッシュ)が同じ時だけ使う。1文字でも変われば、使わずにいつもどおり全部走らせる。
#   * 走っている途中で内容が変わった(コミットしていない変更ができた・コミットが進んだ)時は、通っても、その結果は残さない。
#   * 通った結果は30分で古いものとして使わない。
# --changelog を付けると、更新履歴を先に足してコミットする(ship.sh の --changelog と同じ道具。ship.sh は、もう足してあれば二重に足さない)。
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# shellcheck source=scripts/ship-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/ship-lib.sh"

MODE=start; CHANGELOG_FILE=""; MSG="事前の確認"; WAIT=0; RUN_TREE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --changelog) CHANGELOG_FILE="${2:?--changelog の後に、area/title/description を書いたファイル}"; shift 2 ;;
    --message) MSG="${2:?--message の後に、何を直したか}"; shift 2 ;;
    --wait) WAIT=1; shift ;;
    --status) MODE=status; shift ;;
    --run) MODE=run; RUN_TREE="${2:?}"; shift 2 ;;   # 内部用(裏で走る本体)
    *) echo "知らない指定です: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$PREFLIGHT_DIR"
tree_now() { git rev-parse 'HEAD^{tree}'; }
dirty() { [ -n "$(git status --porcelain --untracked-files=no)" ]; }

state() { # <tree>
  local t="$1" pid
  if [ -f "$PREFLIGHT_DIR/$t.running" ]; then
    pid="$(cat "$PREFLIGHT_DIR/$t.running" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "走っている"; return; fi
  fi
  if [ -f "$PREFLIGHT_DIR/$t.ok" ] && [ -z "$(find "$PREFLIGHT_DIR/$t.ok" -mmin +"$PREFLIGHT_FRESH_MIN" 2>/dev/null)" ]; then echo "通っている"; return; fi
  if [ -f "$PREFLIGHT_DIR/$t.fail" ]; then echo "落ちた"; return; fi
  echo "まだ"
}

if [ "$MODE" = "status" ]; then
  T="$(tree_now)"
  echo "この内容の事前の確認: $(state "$T")(ログ: $PREFLIGHT_DIR/$T.log)"
  exit 0
fi

if [ "$MODE" = "run" ]; then
  T="$RUN_TREE"
  rm -f "$PREFLIGHT_DIR/$T.ok" "$PREFLIGHT_DIR/$T.fail"
  echo $$ > "$PREFLIGHT_DIR/$T.running"
  trap 'rm -f "$PREFLIGHT_DIR/$T.running"' EXIT
  started=$SECONDS
  if run_checks; then
    # 走っているあいだに内容が変わっていたら、この結果は、いまの内容のものではない。残さない。
    if dirty || [ "$(tree_now)" != "$T" ]; then
      echo "✗ 確認が通りましたが、走っているあいだに内容が変わったので、この結果は使いません"
      echo "内容が変わった" > "$PREFLIGHT_DIR/$T.fail"
      exit 1
    fi
    date +%s > "$PREFLIGHT_DIR/$T.ok"
    echo "✓ 事前の確認が通りました($((SECONDS - started))秒)"
  else
    echo "$CHECK_FAIL" > "$PREFLIGHT_DIR/$T.fail"
    echo "✗ 事前の確認が落ちました: $CHECK_FAIL"
    exit 1
  fi
  exit 0
fi

# --- 始める ---
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" != "HEAD" ] && [ "$BRANCH" != "main" ] || { echo "✗ 作業ブランチの中で実行してください(いまは $BRANCH)" >&2; exit 1; }
dirty && { echo "✗ コミットされていない変更があります。先にコミットしてください(コミットした内容を確かめるため)" >&2; exit 1; }

# ship.sh と同じ内容になるよう、main に追いついていなければ取り込む。
git merge-base --is-ancestor main HEAD || { echo "   ブランチが main に追いついていないので、main を取り込みます"; git merge -q --no-edit main; }

if [ -n "$CHANGELOG_FILE" ]; then
  [ -f "$CHANGELOG_FILE" ] || { echo "✗ --changelog のファイルがありません: $CHANGELOG_FILE" >&2; exit 1; }
  echo "   $(node scripts/changelog-add.mjs "$CHANGELOG_FILE")"
  git add src/lib/changelog.ts
  git diff --cached --quiet || git commit -q -m "更新履歴: $MSG

Co-Authored-By: ${SHIP_COAUTHOR:-Claude Sonnet 5.5 <noreply@anthropic.com>}"
fi

T="$(tree_now)"
case "$(state "$T")" in
  "通っている") echo "✓ この内容の事前の確認は、もう通っています"; exit 0 ;;
  "走っている") echo "この内容の事前の確認は、もう走っています" ;;
  *)
    nohup bash "${BASH_SOURCE[0]}" --run "$T" >"$PREFLIGHT_DIR/$T.log" 2>&1 &
    # .running が書かれる前に ship.sh が見に来ても、取りこぼさないよう、書かれるのを少し待つ。
    for _ in 1 2 3 4 5 6 7 8 9 10; do [ -f "$PREFLIGHT_DIR/$T.running" ] && break; sleep 0.2; done
    echo "▶ 事前の確認(型チェックと全テスト)を裏で始めました(約70秒)。そのあいだに、実画面の確認などを進められます"
    echo "   結果: bash scripts/preflight.sh --status ／ ship.sh は、同じ内容の確認が通っていれば、待たずに進みます"
    ;;
esac

if [ "$WAIT" -eq 1 ]; then
  while [ "$(state "$T")" = "走っている" ]; do sleep 0.5; done
  tail -n 6 "$PREFLIGHT_DIR/$T.log" 2>/dev/null || true
  [ "$(state "$T")" = "通っている" ]
fi
