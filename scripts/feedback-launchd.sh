#!/bin/bash
# 修正依頼の常駐見張り(scripts/feedback-daemon.mjs)を、Mac のログイン時に自動で起こす(launchd)。Claude Code の会話が閉じていても動く。
#   bash scripts/feedback-launchd.sh install     … 自動起動を入れて、いま始める
#   bash scripts/feedback-launchd.sh uninstall   … 自動起動を外して、止める
#   bash scripts/feedback-launchd.sh status      … 動いているか(止めの印があるか、直近の記録も)
#   bash scripts/feedback-launchd.sh restart     … 始め直す(コードを直したあとに)
#   bash scripts/feedback-launchd.sh stop        … 止めの印を置く(見張りと通知は続くが、Claude は起こさない)
#   bash scripts/feedback-launchd.sh resume      … 止めの印を消す
#
# 作りの注意(SNSアプリ/poster/*/launchd.sh と同じ事情):
#   ・launchd から起動した「sh」や「ls」は Desktop の中を読めない(macOS のプライバシー保護)が、node を直接起動すれば読める。
#     なので ProgramArguments は node を直接指す。WorkingDirectory は指定しない(launchd 自身が Desktop を開けず、起動に失敗する)
#   ・node のパスは入れた時の `command -v node` を書き込む。node のバージョンを上げたら、もう一度 install する
#   ・裏で起こす claude と git、npm が見つかるよう、PATH に node のある場所と ~/.local/bin(claude)を入れる
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="local.lifehub-feedback-daemon"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
STOP_FILE="$HERE/.feedback-daemon-STOP"

case "${1:-status}" in
  install)
    NODE="$(command -v node)" || { echo "node が見つかりません"; exit 1; }
    CLAUDE="$(command -v claude)" || { echo "claude が見つかりません(裏で直すのに要ります)"; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$HERE/scripts/feedback-daemon.mjs</string></array>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/$LABEL.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/$LABEL.log</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(dirname "$NODE"):$(dirname "$CLAUDE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
</dict></plist>
PLISTEOF
    plutil -lint "$PLIST" >/dev/null
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "入れました: ${PLIST} (node: ${NODE} / claude: ${CLAUDE})"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "外しました"
    ;;
  restart)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then launchctl kickstart -k "$DOMAIN/$LABEL"; else launchctl bootstrap "$DOMAIN" "$PLIST"; fi
    echo "始め直しました"
    ;;
  stop)
    touch "$STOP_FILE"
    echo "止めの印を置きました(見張りと通知は続きますが、Claude は起こしません。再開: bash scripts/feedback-launchd.sh resume)"
    ;;
  resume)
    rm -f "$STOP_FILE"
    echo "止めの印を消しました"
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl print "$DOMAIN/$LABEL" | grep -E "^\s*(state|pid|last exit code|runs) =" | sed 's/^\s*/  /'
      [ -e "$STOP_FILE" ] && echo "  ※ 止めの印があるので、Claude は起こしません(再開: resume)"
      if [ -f "$HERE/.feedback-daemon.log" ]; then
        echo "  --- 直近の記録(.feedback-daemon.log)"
        tail -n 8 "$HERE/.feedback-daemon.log" | sed 's/^/  /'
      fi
    else
      echo "入っていません(bash scripts/feedback-launchd.sh install)"
    fi
    ;;
  *) echo "使い方: bash scripts/feedback-launchd.sh install | uninstall | status | restart | stop | resume"; exit 1 ;;
esac
