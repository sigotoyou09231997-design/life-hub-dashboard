import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailAccount } from "../types";
import type { CalendarSyncResult } from "./googleCalendar";

const mocks = vi.hoisted(() => ({
  accounts: [] as Partial<GmailAccount>[],
  syncNow: vi.fn<() => Promise<string>>(),
  calendarCalls: [] as string[],
}));

vi.mock("../db/schema", () => ({
  db: { gmailAccounts: { toArray: async () => mocks.accounts } },
}));

vi.mock("./syncRuntime", () => ({ syncNow: () => mocks.syncNow() }));

vi.mock("./googleCalendar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./googleCalendar")>();
  return {
    ...actual,
    syncGoogleCalendar: async (account: GmailAccount): Promise<CalendarSyncResult> => {
      mocks.calendarCalls.push(account.email);
      return { added: 2, updated: 0, deleted: 0, skipped: 0, baselined: false, error: null };
    },
  };
});

const { canPullCalendar, describeScheduleRefresh, refreshScheduleSources } = await import("./scheduleRefresh");
const { GOOGLE_CALENDAR_SCOPE } = await import("./googleCalendar");

const empty: CalendarSyncResult = { added: 0, updated: 0, deleted: 0, skipped: 0, baselined: false, error: null };

function account(email: string, extra: Partial<GmailAccount> = {}): Partial<GmailAccount> {
  return { id: email, email, calendarSyncEnabledAt: 1, grantedScopes: GOOGLE_CALENDAR_SCOPE, ...extra };
}

describe("予定・タスクの引っ張って更新", () => {
  beforeEach(() => {
    mocks.accounts = [];
    mocks.calendarCalls = [];
    mocks.syncNow.mockReset();
  });

  it("端末間の同期と、取り込みを入にしてあるアカウントの Googleカレンダーを走らせる", async () => {
    mocks.syncNow.mockResolvedValue("同期しました（受け取り1件）");
    mocks.accounts = [
      account("on@example.com"),
      account("off@example.com", { calendarSyncEnabledAt: 0 }),
      account("reauth@example.com", { reauthRequiredAt: 1 }),
    ];
    const result = await refreshScheduleSources();
    expect(mocks.syncNow).toHaveBeenCalledTimes(1);
    expect(mocks.calendarCalls).toEqual(["on@example.com"]);
    expect(result).toEqual({ message: "同期しました（受け取り1件） / Googleカレンダーから2件追加しました", tone: "success" });
  });

  it("端末間の同期が失敗したら、赤いお知らせにする", async () => {
    mocks.syncNow.mockRejectedValue(new Error("offline"));
    const result = await refreshScheduleSources();
    expect(result).toEqual({ message: "同期に失敗しました: offline", tone: "error" });
  });

  it("カレンダーの権限が無いアカウントは取り込まない", () => {
    expect(canPullCalendar(account("a@example.com", { grantedScopes: "" }) as GmailAccount)).toBe(false);
    expect(canPullCalendar(account("a@example.com") as GmailAccount)).toBe(true);
  });

  it("Googleカレンダーは、変わった時か失敗した時だけ書き足す", () => {
    expect(describeScheduleRefresh({ message: "同期しました（変更はありませんでした）", failed: false }, [empty])).toEqual({
      message: "同期しました（変更はありませんでした）",
      tone: "success",
    });
    expect(
      describeScheduleRefresh({ message: "同期しました（変更はありませんでした）", failed: false }, [
        { ...empty, error: "Googleカレンダーの連携が切れています" },
      ]),
    ).toEqual({ message: "同期しました（変更はありませんでした） / Googleカレンダーの連携が切れています", tone: "error" });
  });
});
