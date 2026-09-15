import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, GmailAccount, GoogleCalendarLink } from "../types";

const mocks = vi.hoisted(() => ({
  events: new Map<string, CalendarEvent>(),
  links: new Map<string, GoogleCalendarLink>(),
  accountUpdates: [] as Record<string, unknown>[],
  responses: [] as { status: number; body: unknown }[],
  requests: [] as string[],
}));

vi.mock("../db/schema", () => ({
  db: {
    calendarEvents: {
      get: async (id: string) => mocks.events.get(id),
      put: async (row: CalendarEvent) => void mocks.events.set(row.id!, row),
      delete: async (id: string) => void mocks.events.delete(id),
    },
    googleCalendarLinks: {
      get: async (id: string) => mocks.links.get(id),
      put: async (row: GoogleCalendarLink) => void mocks.links.set(row.id!, row),
      delete: async (id: string) => void mocks.links.delete(id),
    },
    gmailAccounts: {
      update: async (_id: string, changes: Record<string, unknown>) => {
        mocks.accountUpdates.push(changes);
        return 1;
      },
    },
  },
}));

vi.mock("./gmail", () => ({
  GOOGLE_CALENDAR_SCOPE: "https://www.googleapis.com/auth/calendar.events",
  ensureFreshAccessToken: async (account: GmailAccount) => account,
  htmlToText: (html: string) => html.replace(/<[^>]+>/g, ""),
}));

import {
  describeCalendarError,
  fromGoogleEvent,
  hasCalendarScope,
  importedEventId,
  parseRecurrence,
  shouldAutoSyncCalendar,
  stableUuid,
  summarizeCalendarSync,
  syncGoogleCalendar,
  UNSUPPORTED_REPEAT_NOTE,
  type GoogleCalendarItem,
} from "./googleCalendar";

/** テストを動かす機械の時差に左右されないよう、端末の時刻で日時を作ってRFC3339にする。 */
function local(y: number, m: number, d: number, hh: number, mm: number): string {
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

const account: GmailAccount = {
  id: "acc-1",
  email: "Me@example.com",
  accessToken: "token",
  accessTokenExpiresAt: Date.now() + 3_600_000,
  refreshToken: "refresh",
  connectedAt: 0,
  grantedScopes: "openid email https://www.googleapis.com/auth/calendar.events",
  calendarSyncEnabledAt: 1,
};

beforeEach(() => {
  mocks.events.clear();
  mocks.links.clear();
  mocks.accountUpdates = [];
  mocks.responses = [];
  mocks.requests = [];
  vi.stubGlobal("fetch", async (url: string) => {
    mocks.requests.push(url);
    const next = mocks.responses.shift() ?? { status: 500, body: "no response prepared" };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
      text: async () => (typeof next.body === "string" ? next.body : JSON.stringify(next.body)),
    };
  });
});

describe("stableUuid", () => {
  it("同じ種からは毎回同じ、UUIDの形の値になる(PCとスマホで同じ予定が2件にならない)", async () => {
    const a = await stableUuid("google-calendar:event:me@example.com:abc");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await stableUuid("google-calendar:event:me@example.com:abc")).toBe(a);
    expect(await stableUuid("google-calendar:event:me@example.com:abd")).not.toBe(a);
  });

  it("アドレスの大文字・小文字では別の予定にしない", async () => {
    expect(await importedEventId("Me@Example.com", "abc")).toBe(await importedEventId("me@example.com", "abc"));
  });
});

describe("parseRecurrence", () => {
  it("繰り返さない予定は none", () => {
    expect(parseRecurrence(undefined, "2026-09-16")).toEqual({ repeat: "none" });
  });

  it("毎日・毎週・毎月と、終わりの日", () => {
    expect(parseRecurrence(["RRULE:FREQ=DAILY"], "2026-09-16")).toEqual({ repeat: "daily", repeatUntil: undefined });
    expect(parseRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=WE"], "2026-09-16")).toEqual({ repeat: "weekly", repeatUntil: undefined });
    expect(parseRecurrence(["RRULE:FREQ=MONTHLY;UNTIL=20261231"], "2026-09-16")).toEqual({
      repeat: "monthly",
      repeatUntil: "2026-12-31",
    });
  });

  it("曜日を複数選んだ毎週は、曜日指定の繰り返しにする", () => {
    expect(parseRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"], "2026-09-16")).toEqual({
      repeat: "weekdays:1,3,5",
      repeatUntil: undefined,
    });
  });

  it("LIFE HUBで表せない繰り返し(隔週・回数・毎年・第n曜日)は null", () => {
    expect(parseRecurrence(["RRULE:FREQ=WEEKLY;INTERVAL=2"], "2026-09-16")).toBeNull();
    expect(parseRecurrence(["RRULE:FREQ=DAILY;COUNT=5"], "2026-09-16")).toBeNull();
    expect(parseRecurrence(["RRULE:FREQ=YEARLY"], "2026-09-16")).toBeNull();
    expect(parseRecurrence(["RRULE:FREQ=MONTHLY;BYDAY=2MO"], "2026-09-16")).toBeNull();
  });
});

describe("fromGoogleEvent", () => {
  const NOW = 1_000_000;

  it("時刻つきの予定", () => {
    const result = fromGoogleEvent(
      {
        id: "g1",
        summary: "歯医者",
        location: "駅前クリニック",
        start: { dateTime: local(2026, 9, 16, 10, 0) },
        end: { dateTime: local(2026, 9, 16, 11, 30) },
      },
      undefined,
      NOW,
    );
    expect(result).toEqual({
      kind: "upsert",
      event: expect.objectContaining({
        title: "歯医者",
        date: "2026-09-16",
        endDate: undefined,
        allDay: false,
        startTime: "10:00",
        endTime: "11:30",
        location: "駅前クリニック",
        category: "other",
        repeat: "none",
      }),
    });
  });

  it("終日の予定は、Googleの「その日を含まない終わり」を含む日に直す", () => {
    const oneDay = fromGoogleEvent({ id: "g2", summary: "誕生日", start: { date: "2026-09-16" }, end: { date: "2026-09-17" } }, undefined, NOW);
    expect(oneDay.kind === "upsert" && oneDay.event).toEqual(
      expect.objectContaining({ date: "2026-09-16", endDate: undefined, allDay: true }),
    );
    const stay = fromGoogleEvent({ id: "g3", summary: "京都", start: { date: "2026-09-16" }, end: { date: "2026-09-19" } }, undefined, NOW);
    expect(stay.kind === "upsert" && stay.event).toEqual(expect.objectContaining({ date: "2026-09-16", endDate: "2026-09-18" }));
  });

  it("消された予定は delete、繰り返しの1回だけの変更は取り込まない", () => {
    expect(fromGoogleEvent({ id: "g4", status: "cancelled" }, undefined, NOW)).toEqual({ kind: "delete" });
    expect(
      fromGoogleEvent({ id: "g5_20260916", recurringEventId: "g5", start: { dateTime: local(2026, 9, 16, 9, 0) } }, undefined, NOW).kind,
    ).toBe("skip");
  });

  it("表せない繰り返しは初回だけ入れて、メモにそう書く", () => {
    const result = fromGoogleEvent(
      { id: "g6", summary: "隔週の会議", description: "議題", recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2"], start: { dateTime: local(2026, 9, 16, 9, 0) } },
      undefined,
      NOW,
    );
    expect(result.kind === "upsert" && result.event).toEqual(
      expect.objectContaining({ repeat: "none", memo: `議題\n${UNSUPPORTED_REPEAT_NOTE}` }),
    );
  });

  it("上書きしても、LIFE HUBの側だけにある項目(誰の予定か・通知・カテゴリ)は残す", () => {
    const existing: CalendarEvent = {
      id: "e1",
      title: "古い名前",
      date: "2026-09-16",
      startTime: "10:00",
      category: "important",
      personIds: ["p1"],
      notifyMinutesBefore: 30,
      notifiedAt: 5,
      createdAt: 1,
    };
    const same = fromGoogleEvent(
      { id: "g1", summary: "新しい名前", start: { dateTime: local(2026, 9, 16, 10, 0) } },
      existing,
      NOW,
    );
    expect(same.kind === "upsert" && same.event).toEqual(
      expect.objectContaining({ title: "新しい名前", category: "important", personIds: ["p1"], notifyMinutesBefore: 30, notifiedAt: 5, createdAt: 1 }),
    );
    // 日時が動いたら、もう一度通知できるように「通知済み」を下ろす。
    const moved = fromGoogleEvent({ id: "g1", summary: "新しい名前", start: { dateTime: local(2026, 9, 17, 10, 0) } }, existing, NOW);
    expect(moved.kind === "upsert" && moved.event.notifiedAt).toBeUndefined();
  });
});

describe("syncGoogleCalendar", () => {
  it("連携を始めた直後は、起点だけ取って予定は入れない(すでにある予定は触らない)", async () => {
    mocks.responses = [
      { status: 200, body: { nextPageToken: "page-2" } },
      { status: 200, body: { nextSyncToken: "sync-1" } },
    ];
    const result = await syncGoogleCalendar({ ...account, calendarSyncToken: undefined });
    expect(result).toEqual(expect.objectContaining({ baselined: true, added: 0, error: null }));
    expect(mocks.events.size).toBe(0);
    expect(mocks.accountUpdates).toEqual([expect.objectContaining({ calendarSyncToken: "sync-1", calendarSyncError: "" })]);
    // 予定の中身は受け取らない(fields で落とす)。
    expect(mocks.requests[0]).toContain("fields=nextPageToken%2CnextSyncToken");
  });

  it("前回から足した・変えた・消した予定を取り込み、次の起点を覚える", async () => {
    const deletedId = await importedEventId(account.email, "gone");
    mocks.events.set(deletedId, { id: deletedId, title: "消える予定", date: "2026-09-16", createdAt: 1 });
    const items: GoogleCalendarItem[] = [
      { id: "new", summary: "新しい予定", start: { dateTime: local(2026, 9, 20, 13, 0) }, updated: "2026-09-16T00:00:00Z" },
      { id: "gone", status: "cancelled" },
      { id: "new_20260927", recurringEventId: "new", start: { dateTime: local(2026, 9, 27, 13, 0) } },
    ];
    mocks.responses = [{ status: 200, body: { items, nextSyncToken: "sync-2" } }];

    const result = await syncGoogleCalendar({ ...account, calendarSyncToken: "sync-1" });
    expect(result).toEqual(expect.objectContaining({ added: 1, deleted: 1, skipped: 1, error: null }));

    const newId = await importedEventId(account.email, "new");
    expect(mocks.events.get(newId)).toEqual(expect.objectContaining({ id: newId, title: "新しい予定", startTime: "13:00" }));
    expect(mocks.events.has(deletedId)).toBe(false);
    expect([...mocks.links.values()]).toEqual([
      expect.objectContaining({ eventId: newId, googleEventId: "new", googleUpdated: "2026-09-16T00:00:00Z" }),
    ]);
    expect(mocks.accountUpdates.at(-1)).toEqual(expect.objectContaining({ calendarSyncToken: "sync-2" }));
    expect(mocks.requests[0]).toContain("syncToken=sync-1");
  });

  it("起点が古くなった(410)ら、取り直す", async () => {
    mocks.responses = [
      { status: 410, body: "Sync token is no longer valid" },
      { status: 200, body: { nextSyncToken: "sync-fresh" } },
    ];
    const result = await syncGoogleCalendar({ ...account, calendarSyncToken: "stale" });
    expect(result.baselined).toBe(true);
    expect(mocks.accountUpdates.at(-1)).toEqual(expect.objectContaining({ calendarSyncToken: "sync-fresh" }));
  });

  it("失敗しても理由を覚え、試した時刻は進める(開くたびに同じ失敗を繰り返さない)", async () => {
    mocks.responses = [{ status: 403, body: '{"error":{"errors":[{"reason":"accessNotConfigured"}]}}' }];
    const result = await syncGoogleCalendar({ ...account, calendarSyncToken: "sync-1" });
    expect(result.error).toContain("Google Calendar API が有効になっていません");
    expect(mocks.accountUpdates.at(-1)).toEqual(
      expect.objectContaining({ calendarSyncError: result.error, calendarLastSyncedAt: expect.any(Number) }),
    );
  });
});

describe("describeCalendarError", () => {
  it("権限が足りない時は、つなぎ直しを促す", () => {
    expect(describeCalendarError(new Error("Google Calendar API error (403): ACCESS_TOKEN_SCOPE_INSUFFICIENT")).needsReconnect).toBe(true);
  });
});

describe("summarizeCalendarSync", () => {
  it("何が起きたかを1行にする", () => {
    const base = { added: 0, updated: 0, deleted: 0, skipped: 0, baselined: false, error: null };
    expect(summarizeCalendarSync({ ...base, added: 2, deleted: 1 })).toBe("Googleカレンダーから2件追加・1件削除しました");
    expect(summarizeCalendarSync(base)).toBe("Googleカレンダーに新しい変更はありませんでした");
  });
});

describe("hasCalendarScope / shouldAutoSyncCalendar", () => {
  it("カレンダーの権限があって、入にしてあって、間隔が空いた時だけ自動で取り込む", () => {
    const now = 10_000_000;
    expect(hasCalendarScope({ grantedScopes: "openid email" })).toBe(false);
    expect(hasCalendarScope({})).toBe(false);
    expect(shouldAutoSyncCalendar({ ...account, calendarLastSyncedAt: undefined }, now)).toBe(true);
    expect(shouldAutoSyncCalendar({ ...account, calendarLastSyncedAt: now - 60_000 }, now)).toBe(false);
    expect(shouldAutoSyncCalendar({ ...account, calendarSyncEnabledAt: 0 }, now)).toBe(false);
    expect(shouldAutoSyncCalendar({ ...account, grantedScopes: "openid" }, now)).toBe(false);
    expect(shouldAutoSyncCalendar({ ...account, reauthRequiredAt: 5 }, now)).toBe(false);
  });
});
