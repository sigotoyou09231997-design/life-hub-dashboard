import { useState } from "react";
import { CRASH_LOG_KEY } from "../AppErrorBoundary";
import { readLifecycleLog } from "../../lib/lifecycleLog";
import { currentVersion } from "../../lib/pwaUpdate";
import { useToast } from "../ui/ToastProvider";

/** 端末に残した記録(動きの記録と、最後に起きた画面のエラー)を、貼り付けられる1つの文章にする。 */
export function buildDiagnosticsText(lines: string[], lastCrash: string | null, version: string, userAgent: string): string {
  return [
    `LIFE HUB 調査用の記録 / 版 ${version}`,
    `端末: ${userAgent}`,
    "",
    "最後に起きた画面のエラー:",
    lastCrash ?? "(なし)",
    "",
    "動きの記録(新しいものが下):",
    ...(lines.length > 0 ? lines : ["(なし)"]),
  ].join("\n");
}

/**
 * 設定の「調査用の記録をコピー」(2026-11-21、iPhone で白い画面になる件の調べもの)。
 * 白い画面から戻ったあとに押して、そのまま貼り付けてもらう。記録は端末の中にだけあり、押しても外へは送らない。
 */
export function DiagnosticsCopyButton() {
  const showToast = useToast();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    let lastCrash: string | null = null;
    try {
      lastCrash = window.localStorage.getItem(CRASH_LOG_KEY);
    } catch {
      lastCrash = null;
    }
    const text = buildDiagnosticsText(readLifecycleLog(), lastCrash, currentVersion(), navigator.userAgent);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast("調査用の記録をコピーしました。チャットに貼り付けてください");
    } catch {
      showToast("コピーできませんでした", "error");
    }
  }

  return (
    <div className="system-section__actions">
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex min-h-11 w-full items-center justify-center text-xs font-medium text-slate-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {copied ? "コピーしました" : "調査用の記録をコピー(白い画面などの不具合の時)"}
      </button>
    </div>
  );
}
