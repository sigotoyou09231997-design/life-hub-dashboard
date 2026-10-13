#!/usr/bin/env bash
# ship.sh の部品(試験できるよう、別の場所に出してある)。
#
# 要望を「対応済み」にするのは、**本番(Vercel)に新しい版が出たのを確かめた時だけ**(2026-10-14、本人
# 「対応済みに変わってるけど、本番に反映されてる状態が対応済みであってほしい。それまでは修正中のままに」)。
# 前は、Vercel が20分待っても新しい版にならなかった時でも「対応済み」にしていた。
#
#   finish_feedback <LIVE: 1=本番で確かめた / 0=確かめられなかった> <要望のid> <MAIN_DIR>
# 環境変数 FEEDBACK_INBOX_CMD で、呼ぶ道具を差し替えられる(試験用。既定は node scripts/feedback-inbox.mjs)。

finish_feedback() {
  local live="$1" id="$2" main_dir="$3"
  [ -n "$id" ] || return 0
  if [ "$live" -eq 1 ]; then
    if [ -n "${FEEDBACK_INBOX_CMD:-}" ]; then
      $FEEDBACK_INBOX_CMD --done "$id"
    else
      node "$main_dir/scripts/feedback-inbox.mjs" --done "$id"
    fi
  else
    echo "⚠ 本番(Vercel)で新しい版を確かめられなかったので、要望 $id は「修正中」のままにしました。本番に出たのを確かめてから: node scripts/feedback-inbox.mjs --done $id"
  fi
}

# ---------------------------------------------------------------------------
# 型チェックと全テストを同時に走らせる(ship.sh の本番反映の前と、preflight.sh の事前の確認の両方が使う)。
# 通れば 0、落ちたら 1(理由は CHECK_FAIL に入れる。詳しい出力も画面に出す)。
#
# 全テストは、いつもの2個ではなく4個で走らせる(約110秒 → 約75秒。5個だと混み合って時間切れで落ちるテストが出た)。そのかわり、
# 同時に走らせるのは1つだけにする — 重なると作業用プロセスが何十個にもなり、Mac 全体が止まった(2026-10-12。vitest.config.ts の説明)。
# 順番待ちの札は、10分たったら古いものとして捨てる(落ちた実行の札が残っても詰まらないように)。
run_checks() {
  local log_dir lock_dir waited=0 tsc_pid test_pid tsc_ok=0 test_ok=0
  CHECK_FAIL=""
  # 試験用: 本物の型チェック・全テストの代わりに、この命令を走らせる(scripts の試験が、重い全テストを走らせずに流れを確かめるため)。
  if [ -n "${SHIP_CHECKS_STUB:-}" ]; then
    $SHIP_CHECKS_STUB || { CHECK_FAIL="(試験用の確認が落ちました)"; return 1; }
    return 0
  fi
  log_dir="$(mktemp -d)"
  lock_dir="${TMPDIR:-/tmp}/lifehub-ship-tests.lock"
  until mkdir "$lock_dir" 2>/dev/null; do
    if [ -n "$(find "$lock_dir" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then rmdir "$lock_dir" 2>/dev/null || true; continue; fi
    [ "$waited" -eq 0 ] && echo "   (ほかの確認がテスト中です。終わるのを待ちます)"
    waited=1; sleep 3
  done
  # shellcheck disable=SC2064
  trap "rmdir '$lock_dir' 2>/dev/null || true" EXIT
  npx tsc --noEmit >"$log_dir/tsc.log" 2>&1 & tsc_pid=$!
  VITEST_MAX_FORKS="${SHIP_TEST_FORKS:-4}" npm test >"$log_dir/test.log" 2>&1 & test_pid=$!
  wait "$tsc_pid" || tsc_ok=1
  wait "$test_pid" || test_ok=1
  rmdir "$lock_dir" 2>/dev/null || true
  grep -E "^ +(Test Files|Tests) |^ FAIL" "$log_dir/test.log" || true
  if [ "$tsc_ok" -ne 0 ]; then
    head -30 "$log_dir/tsc.log" || true
    CHECK_FAIL="型チェックが落ちました。main には入れていません"
    return 1
  fi
  # テストが全部通っても、描き終わった後に起きた未処理のエラー(Errors N errors)で終了コードが 1 になることがある。
  # それも「落ちた」として止める(1 になった理由が見えるよう、該当の行を出す)。
  # 落ちた理由が「時間切れ」だけの時は、落ちたファイルだけを、1つずつ(並列1)静かな状態で再実行する(2026-10-13)。
  # 並列で Mac が混むと、内容は正しいのに5〜15秒を超えて落ちるテストが出て、そのたびに数分かけて出し直していたため。
  # 再実行でも落ちれば、これまでどおり止まる。通ったら「時間切れで落ち、単独では通った」と表示して進む(落ちたテストを飛ばすのではなく、
  # 混み合いが原因だったと確かめる)。時間切れ以外の理由(AssertionError など)が1つでもあれば、再実行せずに止まる。
  if [ "$test_ok" -ne 0 ]; then
    local clean_log fail_n timeout_n other_n files
    clean_log="$(sed 's/\x1b\[[0-9;]*m//g' "$log_dir/test.log")"
    # 「Failed Tests」の各項目は「 FAIL <ファイル> > <テスト名>」の次の行に原因が出る。1件ずつ、原因が時間切れか数える。
    # 時間切れ以外(AssertionError・TypeError・未処理のエラーなど)が1件でもあれば、再実行せずに止まる。
    read -r fail_n timeout_n <<EOF_COUNT
$(echo "$clean_log" | awk '/^⎯+ Failed Tests/{in_fail=1; next} in_fail && /^ FAIL /{n++; want=1; next} in_fail && want && NF{ if ($0 ~ /^Error: (Test|Hook) timed out/) t++; want=0 } END{print n+0, t+0}')
EOF_COUNT
    other_n="$(echo "$clean_log" | grep -cE 'Unhandled|Errors +[0-9]+ error' || true)"
    if [ "$fail_n" -gt 0 ] && [ "$fail_n" -eq "$timeout_n" ] && [ "$other_n" -eq 0 ]; then
      files="$(echo "$clean_log" | grep -E '^ FAIL ' | sed -E 's/^ FAIL +([^ ]+).*/\1/' | sort -u | tr '\n' ' ')"
      echo "   時間切れだけで落ちたテスト(${fail_n}件)があります。落ちたファイルだけを、1つずつ静かな状態で再実行します: $files"
      # shellcheck disable=SC2086
      if VITEST_MAX_FORKS=1 npx vitest run $files >"$log_dir/retry.log" 2>&1; then
        echo "   ✓ 再実行では全部通りました(混み合いで時間切れになっただけ)。進めます"
        test_ok=0
      fi
    fi
  fi
  if [ "$test_ok" -ne 0 ]; then
    grep -E "FAIL|×|AssertionError|Errors |Uncaught|This error originated" "$log_dir/test.log" | head -20 || true
    CHECK_FAIL="テストの終了コードが 0 ではありません(全文: $log_dir/test.log)。main には入れていません"
    return 1
  fi
  rm -rf "$log_dir"
  return 0
}

# ---------------------------------------------------------------------------
# 事前の確認(scripts/preflight.sh)の結果を使う。
#
# 型チェックと全テストは、書き終えた直後(コミットした直後)に裏で走らせておける。そのあいだに、実画面の確認や更新履歴の準備をすれば、
# 出す時にテストの終わりを待たなくて済む(2026-10-14。1回あたり約60〜70秒)。
# **使うのは、「同じ内容」の確認だけ**: 鍵は、コミットの木(git の HEAD^{tree} = ファイルの中身全部のハッシュ)。1文字でも変わっていたら鍵が変わるので、
# 前の確認の結果は使わず、いつもどおり全部走らせる。通った結果は30分で古いものとして使わない(日付に左右されるテストがあるため)。
PREFLIGHT_DIR="${SHIP_PREFLIGHT_DIR:-${TMPDIR:-/tmp}/lifehub-preflight}"
PREFLIGHT_FRESH_MIN=30

# 同じ木の確認が、通っているなら 0。走っている最中なら、終わるのを待つ(最大10分)。通っていない・落ちた・無い時は 1。
preflight_reuse() {
  local tree="$1" waited=0 pid
  mkdir -p "$PREFLIGHT_DIR"
  while [ -f "$PREFLIGHT_DIR/$tree.running" ]; do
    pid="$(cat "$PREFLIGHT_DIR/$tree.running" 2>/dev/null || true)"
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then rm -f "$PREFLIGHT_DIR/$tree.running"; break; fi
    [ "$waited" -eq 0 ] && echo "   (同じ内容の事前の確認が走っています。終わるのを待ちます)"
    waited=$((waited + 1)); [ "$waited" -gt 1200 ] && return 1
    sleep 0.5
  done
  [ -f "$PREFLIGHT_DIR/$tree.ok" ] || return 1
  [ -z "$(find "$PREFLIGHT_DIR/$tree.ok" -mmin +"$PREFLIGHT_FRESH_MIN" 2>/dev/null)" ] || return 1
  return 0
}
