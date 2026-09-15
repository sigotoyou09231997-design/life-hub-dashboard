import { useState } from "react";
import { CalendarSync } from "lucide-react";
import { db } from "../../db/schema";
import type { GmailAccount } from "../../types";
import { startGmailOAuth } from "../../lib/gmail";
import {
  CALENDAR_ENABLE_AFTER_CONNECT_KEY,
  hasCalendarScope,
  isCalendarSyncEnabled,
  summarizeCalendarSync,
  syncGoogleCalendar,
} from "../../lib/googleCalendar";
import { formatGmailTimestamp } from "../../lib/date";
import { SwitchField } from "../ui/SwitchField";
import { useToast } from "../ui/ToastProvider";

/**
 * 設定画面のGmailアカウント1件ぶんの「Googleカレンダーから予定を取り込む」(src/lib/googleCalendar.ts)。
 *
 * カレンダーの権限はGmailの連携と同じGoogleログインに足すので、この機能より前に連携した
 * アカウントは一度つなぎ直しが要る(依頼本文で「その場合は仕方ない」と了承済み)。
 * つなぎ直しから戻ると、そのまま取り込みが入になる(GmailCallbackPage)。
 */
export function GoogleCalendarSyncControl({ account }: { account: GmailAccount }) {
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const enabled = isCalendarSyncEnabled(account);

  function handleReconnect() {
    sessionStorage.setItem(CALENDAR_ENABLE_AFTER_CONNECT_KEY, account.email);
    startGmailOAuth();
  }

  async function runSync(target: GmailAccount) {
    setBusy(true);
    try {
      const result = await syncGoogleCalendar(target);
      showToast(summarizeCalendarSync(result), result.error ? "error" : "success");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(on: boolean) {
    if (!account.id) return;
    if (!on) {
      // 切っても、取り込み済みの予定は消さない(LIFE HUBの予定として残す)。
      // 起点も捨てて、次に入にした時はその時点からの変更だけを取り込む。
      await db.gmailAccounts.update(account.id, {
        calendarSyncEnabledAt: 0,
        calendarSyncToken: undefined,
        calendarSyncError: "",
      });
      showToast("Googleカレンダーの取り込みを止めました");
      return;
    }
    const changes = { calendarSyncEnabledAt: Date.now(), calendarSyncToken: undefined, calendarSyncError: "" };
    await db.gmailAccounts.update(account.id, changes);
    await runSync({ ...account, ...changes });
  }

  if (!hasCalendarScope(account)) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg bg-white/40 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <CalendarSync size={14} />
          Googleカレンダーの取り込み
        </p>
        <p className="text-xs leading-relaxed text-slate-500">
          Googleカレンダーの予定をLIFE HUBに取り込むには、カレンダーの権限を足すため一度つなぎ直してください。
        </p>
        <button
          type="button"
          onClick={handleReconnect}
          className="self-start text-xs font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          つなぎ直してカレンダーも許可する
        </button>
      </div>
    );
  }

  const status = !enabled
    ? "メインのカレンダーで、入にした後に足した・変えた・消した予定を取り込みます(今ある予定は入れません)"
    : account.calendarSyncError
      ? account.calendarSyncError
      : account.calendarLastSyncedAt
        ? `最後に確認: ${formatGmailTimestamp(account.calendarLastSyncedAt)}`
        : "これから足した・変えた予定を取り込みます";

  return (
    <div className="flex flex-col gap-1">
      <SwitchField
        label="Googleカレンダーから予定を取り込む"
        hint={status}
        checked={enabled}
        onChange={(on) => void handleToggle(on)}
      />
      {enabled && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void runSync(account)}
          className="self-start px-[0.9rem] text-xs font-medium text-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {busy ? "取り込んでいます…" : "今すぐ取り込む"}
        </button>
      )}
    </div>
  );
}
