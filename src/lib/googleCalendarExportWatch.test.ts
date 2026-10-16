import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailAccount } from "../types";

const mocks = vi.hoisted(() => ({
  hooks: {} as Record<string, (this: { onsuccess?: () => void }) => unknown>,
  accounts: [] as Partial<GmailAccount>[],
  synced: [] as { email: string; pull?: boolean }[],
}));

vi.mock("../db/schema", () => ({
  db: {
    calendarEvents: {
      hook: (name: string, fn: (this: { onsuccess?: () => void }) => unknown) => {
        mocks.hooks[name] = fn;
      },
    },
    gmailAccounts: { toArray: async () => mocks.accounts },
  },
}));

vi.mock("./googleCalendar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./googleCalendar")>()),
  syncGoogleCalendar: async (account: GmailAccount, options?: { pull?: boolean }) => {
    mocks.synced.push({ email: account.email, pull: options?.pull });
    return {};
  },
}));

const { EXPORT_DEBOUNCE_MS, installCalendarExportWatcher, resetCalendarExportWatcherForTests, scheduleCalendarExport } = await import("./googleCalendarExportWatch");
const { GOOGLE_CALENDAR_SCOPE } = await import("./googleCalendar");

/** フックを「書き込みが成功した」ところまで動かす。 */
function fire(name: string) {
  const ctx: { onsuccess?: () => void } = {};
  mocks.hooks[name].call(ctx);
  ctx.onsuccess?.();
}

describe("予定を変えた後の Googleカレンダーへの書き出し", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.accounts = [
      { id: "a", email: "on@example.com", calendarSyncEnabledAt: 1, grantedScopes: GOOGLE_CALENDAR_SCOPE },
      { id: "b", email: "off@example.com", calendarSyncEnabledAt: 0, grantedScopes: GOOGLE_CALENDAR_SCOPE },
      { id: "c", email: "noscope@example.com", calendarSyncEnabledAt: 1, grantedScopes: "openid" },
    ];
    mocks.synced = [];
    resetCalendarExportWatcherForTests();
    installCalendarExportWatcher();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("足す・変える・消すのどれでも、少し待ってから、同期を入にしてあるアカウントだけ書き出し(pull: false)を1回走らせる", async () => {
    expect(Object.keys(mocks.hooks).sort()).toEqual(["creating", "deleting", "updating"]);
    fire("creating");
    fire("updating");
    fire("deleting");
    expect(mocks.synced).toEqual([]);
    await vi.advanceTimersByTimeAsync(EXPORT_DEBOUNCE_MS - 1);
    expect(mocks.synced).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.synced).toEqual([{ email: "on@example.com", pull: false }]);
  });

  it("続けて変えたら、最後の変更から数えて1回だけ", async () => {
    scheduleCalendarExport();
    await vi.advanceTimersByTimeAsync(EXPORT_DEBOUNCE_MS - 500);
    scheduleCalendarExport();
    await vi.advanceTimersByTimeAsync(EXPORT_DEBOUNCE_MS - 500);
    expect(mocks.synced).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.synced).toHaveLength(1);
  });

  it("オフラインの時は送らない(次に画面を開いた時の同期に任せる)", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    try {
      scheduleCalendarExport();
      await vi.advanceTimersByTimeAsync(EXPORT_DEBOUNCE_MS);
      expect(mocks.synced).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
