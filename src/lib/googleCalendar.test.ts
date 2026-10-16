import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, GmailAccount, GoogleCalendarLink } from "../types";

const mocks = vi.hoisted(() => ({
  events: new Map<string, CalendarEvent>(),
  links: new Map<string, GoogleCalendarLink>(),
  accountUpdates: [] as Record<string, unknown>[],
  responses: [] as { status: number; body: unknown }[],
  requests: [] as string[],
  calls: [] as { url: string; method: string; body?: any }[],
}));

vi.mock("../db/schema", () => ({
  db: {
    calendarEvents: {
      get: async (id: string) => mocks.events.get(id),
      put: async (row: CalendarEvent) => void mocks.events.set(row.id!, row),
      delete: async (id: string) => void mocks.events.delete(id),
      toArray: async () => [...mocks.events.values()],
    },
    googleCalendarLinks: {
      get: async (id: string) => mocks.links.get(id),
      put: async (row: GoogleCalendarLink) => void mocks.links.set(row.id!, row),
      delete: async (id: string) => void mocks.links.delete(id),
      toArray: async () => [...mocks.links.values()],
      where: (index: string) => ({
        equals: (key: [string, string]) => ({
          toArray: async () => {
            if (index !== "[accountEmail+googleEventId]") throw new Error(`unexpected index ${index}`);
            return [...mocks.links.values()].filter((l) => l.accountEmail === key[0] && l.googleEventId === key[1]);
          },
        }),
      }),
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
  EMPTY_CALENDAR_SYNC_RESULT,
  eventIdFromGoogleId,
  fromGoogleEvent,
  googleEventIdFor,
  hasCalendarScope,
  importedEventId,
  importedLinkId,
  parseRecurrence,
  planExport,
  shouldAutoSyncCalendar,
  stableUuid,
  summarizeCalendarSync,
  syncGoogleCalendar,
  toGoogleEvent,
  toRecurrence,
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
  mocks.calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
    mocks.requests.push(url);
    mocks.calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
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
    const base = EMPTY_CALENDAR_SYNC_RESULT;
    expect(summarizeCalendarSync({ ...base, added: 2, deleted: 1 })).toBe("Googleカレンダーから2件追加・1件削除しました");
    expect(summarizeCalendarSync({ ...base, exported: 3 })).toBe("Googleカレンダーへ3件送信しました");
    expect(summarizeCalendarSync({ ...base, added: 1, exported: 1, removed: 1 })).toBe("Googleカレンダーから1件追加、Googleカレンダーへ1件送信・1件削除しました");
    expect(summarizeCalendarSync(base)).toBe("Googleカレンダーとの間に新しい変更はありませんでした");
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

// ---------------------------------------------------------------------------
// 第2段: LIFE HUB → Google の書き出し(2026-10-16)
// ---------------------------------------------------------------------------

describe("googleEventIdFor / eventIdFromGoogleId", () => {
  it("予定のUUIDからハイフンを抜いた32文字にし、元に戻せる(Googleが付けた26文字のidは戻さない)", () => {
    const id = "0f3c2a9e-1b4d-5c6e-8f90-a1b2c3d4e5f6";
    expect(googleEventIdFor(id)).toBe("0f3c2a9e1b4d5c6e8f90a1b2c3d4e5f6");
    expect(googleEventIdFor(id)).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(eventIdFromGoogleId(googleEventIdFor(id))).toBe(id);
    expect(eventIdFromGoogleId("_6co34c9g6ko3ab9k60o3ab9kc")).toBeNull();
    expect(eventIdFromGoogleId("abc")).toBeNull();
  });
});

describe("toRecurrence", () => {
  it("毎日・毎週・毎月・曜日指定を RRULE にし、繰り返さない予定は空(繰り返しを消す)", () => {
    expect(toRecurrence({ repeat: "none" })).toEqual([]);
    expect(toRecurrence({})).toEqual([]);
    expect(toRecurrence({ repeat: "daily" })).toEqual(["RRULE:FREQ=DAILY"]);
    expect(toRecurrence({ repeat: "weekly" })).toEqual(["RRULE:FREQ=WEEKLY"]);
    expect(toRecurrence({ repeat: "monthly" })).toEqual(["RRULE:FREQ=MONTHLY"]);
    expect(toRecurrence({ repeat: "weekdays:1,3,5" })).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]);
  });

  it("終わりの日は、終日なら日付、時刻つきなら端末の時刻の 23:59:59 を UTC にして付ける(取り込みで同じ日に戻る)", () => {
    expect(toRecurrence({ repeat: "weekly", repeatUntil: "2026-12-31", allDay: true })).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20261231"]);
    const [timed] = toRecurrence({ repeat: "weekly", repeatUntil: "2026-12-31", startTime: "10:00" });
    const until = /UNTIL=(\d{8}T\d{6}Z)/.exec(timed)![1];
    expect(parseRecurrence([timed], "2026-10-07")).toEqual({ repeat: "weekly", repeatUntil: "2026-12-31" });
    expect(until.endsWith("Z")).toBe(true);
  });
});

describe("toGoogleEvent", () => {
  const tz = "Asia/Tokyo";
  it("時刻つきの予定は端末の時刻＋時間帯で送り、終わりが無ければ1時間にする", () => {
    const body = toGoogleEvent({ id: "e1", title: " 打合せ ", date: "2026-10-20", startTime: "13:30", endTime: "15:00", location: "渋谷", memo: "資料持参", createdAt: 1 }, tz);
    expect(body).toEqual({
      status: "confirmed",
      summary: "打合せ",
      description: "資料持参",
      location: "渋谷",
      start: { dateTime: "2026-10-20T13:30:00", timeZone: tz, date: null },
      end: { dateTime: "2026-10-20T15:00:00", timeZone: tz, date: null },
      recurrence: [],
    });
    const open = toGoogleEvent({ id: "e2", title: "歯医者", date: "2026-10-20", startTime: "23:30", createdAt: 1 }, tz);
    expect(open.end).toEqual({ dateTime: "2026-10-21T00:30:00", timeZone: tz, date: null });
  });

  it("終日(時刻の無い予定)は日付で送り、終わりは「含まない翌日」にする。何日かにまたがる予定も同じ", () => {
    const one = toGoogleEvent({ id: "e3", title: "休み", date: "2026-10-20", allDay: true, createdAt: 1 }, tz);
    expect(one.start).toEqual({ date: "2026-10-20", dateTime: null, timeZone: null });
    expect(one.end).toEqual({ date: "2026-10-21", dateTime: null, timeZone: null });
    const span = toGoogleEvent({ id: "e4", title: "出張", date: "2026-10-20", endDate: "2026-10-22", createdAt: 1 }, tz);
    expect(span.end).toEqual({ date: "2026-10-23", dateTime: null, timeZone: null });
    expect(fromGoogleEvent({ id: "x", summary: "出張", start: { date: "2026-10-20" }, end: { date: "2026-10-23" } }, undefined, 0)).toEqual(
      expect.objectContaining({ kind: "upsert", event: expect.objectContaining({ date: "2026-10-20", endDate: "2026-10-22", allDay: true }) }),
    );
  });

  it("空のタイトルは「(タイトルなし)」、取り込みで付けた繰り返しの注記は送らない", () => {
    const body = toGoogleEvent({ id: "e5", title: "  ", date: "2026-10-20", memo: `毎年の予定\n${UNSUPPORTED_REPEAT_NOTE}`, createdAt: 1 }, tz);
    expect(body.summary).toBe("(タイトルなし)");
    expect(body.description).toBe("毎年の予定");
  });
});

describe("planExport", () => {
  const enabledAt = 1_000_000;
  const email = "me@example.com";
  const link = (eventId: string, extra: Partial<GoogleCalendarLink> = {}): GoogleCalendarLink => ({
    id: `l-${eventId}`,
    eventId,
    accountEmail: "Me@example.com",
    googleEventId: `g-${eventId}`,
    createdAt: enabledAt,
    updatedAt: enabledAt + 100,
    ...extra,
  });
  const ev = (id: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, title: id, date: "2026-10-20", createdAt: enabledAt + 10, ...extra });

  it("入にした後に足した予定だけ作り、入にする前からある予定は触らない(依頼のとおり)", () => {
    const plan = planExport([ev("new"), ev("old", { createdAt: 1, updatedAt: 2 })], [], email, enabledAt);
    expect(plan.create.map((e) => e.id)).toEqual(["new"]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("入にする前からある予定でも、入にした後に変えたものは送る(「足した/変えた分から」)", () => {
    const plan = planExport([ev("old", { createdAt: 1, updatedAt: enabledAt + 5 })], [], email, enabledAt);
    expect(plan.create.map((e) => e.id)).toEqual(["old"]);
  });

  it("対応表がある予定は、最後に同期した時刻より後に変えたものだけ更新する(アドレスの大文字・小文字は無視)", () => {
    const events = [ev("same", { updatedAt: enabledAt + 100 }), ev("changed", { updatedAt: enabledAt + 200 })];
    const plan = planExport(events, [link("same"), link("changed")], email, enabledAt);
    expect(plan.create).toEqual([]);
    expect(plan.update.map((u) => u.event.id)).toEqual(["changed"]);
  });

  it("予定が消えて対応表だけ残っていれば Google からも消す。別のアカウントの対応表は見ない", () => {
    const plan = planExport([], [link("gone"), link("other", { accountEmail: "other@example.com" })], email, enabledAt);
    expect(plan.remove.map((l) => l.eventId)).toEqual(["gone"]);
  });

  it("Google から取り込んだ予定(対応表あり・作った時刻は古い)は、変えていなければ何もしない", () => {
    const imported = ev("imp", { createdAt: 1, updatedAt: enabledAt + 100 });
    const plan = planExport([imported], [link("imp")], email, enabledAt);
    expect(plan).toEqual({ create: [], update: [], remove: [] });
  });
});

describe("syncGoogleCalendar の書き出し", () => {
  const enabled: GmailAccount = { ...account, calendarSyncEnabledAt: 1_000_000, calendarSyncToken: "sync-1" };
  const noChanges = { status: 200, body: { items: [], nextSyncToken: "sync-2" } };

  it("LIFE HUB で足した予定を Google に作り(idは予定のUUIDから)、対応表に覚える", async () => {
    mocks.events.set("0f3c2a9e-1b4d-5c6e-8f90-a1b2c3d4e5f6", {
      id: "0f3c2a9e-1b4d-5c6e-8f90-a1b2c3d4e5f6",
      title: "新しい予定",
      date: "2026-10-20",
      startTime: "10:00",
      createdAt: 1_000_010,
      updatedAt: 1_000_010,
    });
    mocks.responses = [noChanges, { status: 200, body: { id: "0f3c2a9e1b4d5c6e8f90a1b2c3d4e5f6", updated: "2026-10-16T01:00:00Z" } }];
    const result = await syncGoogleCalendar(enabled);
    expect(result).toEqual(expect.objectContaining({ exported: 1, removed: 0, error: null }));
    const post = mocks.calls[1];
    expect(post.method).toBe("POST");
    expect(post.url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    expect(post.body).toEqual(expect.objectContaining({ id: "0f3c2a9e1b4d5c6e8f90a1b2c3d4e5f6", summary: "新しい予定" }));
    expect(post.body.start.dateTime).toBe("2026-10-20T10:00:00");
    const linkId = await importedLinkId(account.email, "0f3c2a9e1b4d5c6e8f90a1b2c3d4e5f6");
    expect(mocks.links.get(linkId)).toEqual(
      expect.objectContaining({
        eventId: "0f3c2a9e-1b4d-5c6e-8f90-a1b2c3d4e5f6",
        googleEventId: "0f3c2a9e1b4d5c6e8f90a1b2c3d4e5f6",
        googleUpdated: "2026-10-16T01:00:00Z",
      }),
    );
    expect(summarizeCalendarSync(result)).toBe("Googleカレンダーへ1件送信しました");
  });

  it("Google に同じidがもうあれば(ほかの端末が先に送った)、2件目を作らず上書きする", async () => {
    mocks.events.set("0f3c2a9e-1b4d-5c6e-8f90-a1b2c3d4e5f6", {
      id: "0f3c2a9e-1b4d-5c6e-8f90-a1b2c3d4e5f6",
      title: "新しい予定",
      date: "2026-10-20",
      createdAt: 1_000_010,
    });
    mocks.responses = [
      noChanges,
      { status: 409, body: '{"error":{"message":"The requested identifier already exists."}}' },
      { status: 200, body: { id: "0f3c2a9e1b4d5c6e8f90a1b2c3d4e5f6", updated: "2026-10-16T02:00:00Z" } },
    ];
    const result = await syncGoogleCalendar(enabled);
    expect(result.exported).toBe(1);
    expect(mocks.calls.map((c) => c.method)).toEqual(["GET", "POST", "PATCH"]);
    expect(mocks.calls[2].url).toContain("/events/0f3c2a9e1b4d5c6e8f90a1b2c3d4e5f6");
    expect(mocks.calls[2].body.status).toBe("confirmed");
  });

  it("前回の同期より後に変えた予定は PATCH で送り、消した予定は DELETE する。変えていない予定は送らない", async () => {
    mocks.events.set("changed", { id: "changed", title: "変えた", date: "2026-10-20", createdAt: 1, updatedAt: 1_000_300 });
    mocks.events.set("same", { id: "same", title: "そのまま", date: "2026-10-20", createdAt: 1, updatedAt: 1_000_100 });
    mocks.links.set("l1", { id: "l1", eventId: "changed", accountEmail: account.email, googleEventId: "g-changed", createdAt: 1, updatedAt: 1_000_200 });
    mocks.links.set("l2", { id: "l2", eventId: "same", accountEmail: account.email, googleEventId: "g-same", createdAt: 1, updatedAt: 1_000_200 });
    mocks.links.set("l3", { id: "l3", eventId: "gone", accountEmail: account.email, googleEventId: "g-gone", createdAt: 1, updatedAt: 1_000_200 });
    mocks.responses = [noChanges, { status: 204, body: "" }, { status: 200, body: { id: "g-changed", updated: "2026-10-16T03:00:00Z" } }];
    const result = await syncGoogleCalendar(enabled);
    expect(result).toEqual(expect.objectContaining({ exported: 1, removed: 1, error: null }));
    expect(mocks.calls.slice(1).map((c) => `${c.method} ${c.url.split("/events")[1]}`)).toEqual(["DELETE /g-gone", "PATCH /g-changed"]);
    expect(mocks.links.has("l3")).toBe(false);
    expect(mocks.links.get("l1")).toEqual(expect.objectContaining({ googleUpdated: "2026-10-16T03:00:00Z" }));
    expect(mocks.links.get("l1")!.updatedAt!).toBeGreaterThanOrEqual(1_000_300);
    expect(summarizeCalendarSync(result)).toBe("Googleカレンダーへ1件送信・1件削除しました");
  });

  it("こちらが送った版がそのまま Google から返ってきても、取り込み直さない(更新の数に入れない)", async () => {
    mocks.events.set("mine", { id: "mine", title: "LIFE HUB の文", date: "2026-10-20", createdAt: 1, updatedAt: 1_000_100 });
    mocks.links.set("l1", {
      id: "l1",
      eventId: "mine",
      accountEmail: account.email,
      googleEventId: "g-mine",
      googleUpdated: "2026-10-16T01:00:00Z",
      createdAt: 1,
      updatedAt: 1_000_200,
    });
    const echo: GoogleCalendarItem = { id: "g-mine", summary: "Google が整えた文", start: { date: "2026-10-20" }, end: { date: "2026-10-21" }, updated: "2026-10-16T01:00:00Z" };
    mocks.responses = [{ status: 200, body: { items: [echo], nextSyncToken: "sync-2" } }];
    const result = await syncGoogleCalendar(enabled);
    expect(result).toEqual(expect.objectContaining({ added: 0, updated: 0, exported: 0, error: null }));
    expect(mocks.events.get("mine")!.title).toBe("LIFE HUB の文");
  });

  it("Google 側で変えた分は、対応表から LIFE HUB の予定(UUIDから付けたid)を引いて上書きする", async () => {
    mocks.events.set("0f3c2a9e-1b4d-5c6e-8f90-a1b2c3d4e5f6", { id: "0f3c2a9e-1b4d-5c6e-8f90-a1b2c3d4e5f6", title: "前の題", date: "2026-10-20", createdAt: 1, updatedAt: 1_000_100, category: "work" });
    const item: GoogleCalendarItem = { id: "0f3c2a9e1b4d5c6e8f90a1b2c3d4e5f6", summary: "Google で直した題", start: { date: "2026-10-21" }, end: { date: "2026-10-22" }, updated: "2026-10-16T05:00:00Z" };
    mocks.responses = [{ status: 200, body: { items: [item], nextSyncToken: "sync-2" } }];
    const result = await syncGoogleCalendar(enabled);
    expect(result).toEqual(expect.objectContaining({ updated: 1, added: 0, exported: 0 }));
    expect(mocks.events.size).toBe(1);
    expect(mocks.events.get("0f3c2a9e-1b4d-5c6e-8f90-a1b2c3d4e5f6")).toEqual(expect.objectContaining({ title: "Google で直した題", date: "2026-10-21", category: "work" }));
    expect([...mocks.links.values()]).toEqual([expect.objectContaining({ eventId: "0f3c2a9e-1b4d-5c6e-8f90-a1b2c3d4e5f6", googleUpdated: "2026-10-16T05:00:00Z" })]);
  });

  it("pull: false なら取り込みを飛ばして書き出しだけ(予定を変えた直後)。失敗は理由を覚える", async () => {
    mocks.events.set("new", { id: "new", title: "新しい予定", date: "2026-10-20", createdAt: 1_000_010 });
    mocks.responses = [{ status: 200, body: { id: "new", updated: "2026-10-16T01:00:00Z" } }];
    const result = await syncGoogleCalendar(enabled, { pull: false });
    expect(result.exported).toBe(1);
    expect(mocks.calls.map((c) => c.method)).toEqual(["POST"]);

    mocks.events.set("new2", { id: "new2", title: "もう1件", date: "2026-10-20", createdAt: 1_000_010 });
    mocks.responses = [{ status: 403, body: '{"error":{"errors":[{"reason":"insufficientPermissions"}]}}' }];
    const failed = await syncGoogleCalendar(enabled, { pull: false });
    expect(failed.error).toContain("権限がありません");
    expect(mocks.accountUpdates.at(-1)).toEqual(expect.objectContaining({ calendarSyncError: failed.error }));
  });

  it("入にしていないアカウントでは何も送らない", async () => {
    mocks.events.set("new", { id: "new", title: "新しい予定", date: "2026-10-20", createdAt: 1_000_010 });
    const result = await syncGoogleCalendar({ ...enabled, calendarSyncEnabledAt: undefined }, { pull: false });
    expect(result.exported).toBe(0);
    expect(mocks.calls).toEqual([]);
  });
});
