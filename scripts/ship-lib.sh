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
