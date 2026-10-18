import { describe, expect, it } from "vitest";
import type { CalendarEvent, SyncedEmail, Trip, TripScheduleItem } from "../types";
import {
  RECENT_STORAGE_KEY,
  RECENT_STORE_LIMIT,
  buildRecentList,
  emptyRecentRows,
  loadRecent,
  recentEntryForPath,
  recordRecent,
  type RecentEntry,
  type RecentRows,
} from "./recentItems";

/** localStorage の代わり。中身を見られるように Map で持つ。 */
function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(RECENT_STORAGE_KEY, initial);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const trip: Trip = {
  id: "trip1",
  name: "夏の京都",
  destination: "京都",
  startDate: "2026-09-01",
  endDate: "2026-09-03",
  status: "planning",
  createdAt: 1,
};

const tripItem: TripScheduleItem = {
  id: "ts1",
  tripId: "trip1",
  date: "2026-09-02",
  title: "青葉庵で昼食",
  type: "meal",
  createdAt: 1,
};

const email: SyncedEmail = {
  id: "m1",
  accountId: "a1",
  gmailMessageId: "g1",
  threadId: "th1",
  from: "予約 <yoyaku@aoba.example.com>",
  subject: "ご予約の確認",
  snippet: "",
  receivedAt: 1,
  status: "unprocessed",
  createdAt: 1,
};

const event: CalendarEvent = { id: "e1", title: "歯医者", date: "2026-10-20", createdAt: 1, personIds: ["p1"] };

function rows(overrides: Partial<RecentRows> = {}): RecentRows {
  return {
    ...emptyRecentRows(),
    trips: new Map([["trip1", trip]]),
    tripSchedule: new Map([["ts1", tripItem]]),
    emails: new Map([["m1", email]]),
    events: new Map([["e1", event]]),
    ...overrides,
  };
}

const entry = (kind: RecentEntry["kind"], id: string, at = 1): RecentEntry => ({ kind, id, at });

describe("recordRecent / loadRecent", () => {
  it("新しく開いたものを先頭に足す", () => {
    const storage = memoryStorage();
    recordRecent({ kind: "trip", id: "trip1" }, storage, 100);
    recordRecent({ kind: "email", id: "m1" }, storage, 200);
    expect(loadRecent(storage)).toEqual([entry("email", "m1", 200), entry("trip", "trip1", 100)]);
  });

  it("同じものをもう一度開いたら、重ねずに先頭へ上げる", () => {
    const storage = memoryStorage();
    recordRecent({ kind: "trip", id: "trip1" }, storage, 100);
    recordRecent({ kind: "email", id: "m1" }, storage, 200);
    recordRecent({ kind: "trip", id: "trip1" }, storage, 300);
    expect(loadRecent(storage).map((e) => `${e.kind}:${e.id}`)).toEqual(["trip:trip1", "email:m1"]);
  });

  it("種類が違えば同じidでも別のもの", () => {
    const storage = memoryStorage();
    recordRecent({ kind: "event", id: "x" }, storage, 1);
    recordRecent({ kind: "task", id: "x" }, storage, 2);
    expect(loadRecent(storage)).toHaveLength(2);
  });

  it("残す数には上限がある", () => {
    const storage = memoryStorage();
    for (let i = 0; i < RECENT_STORE_LIMIT + 5; i++) recordRecent({ kind: "trip", id: `t${i}` }, storage, i);
    const loaded = loadRecent(storage);
    expect(loaded).toHaveLength(RECENT_STORE_LIMIT);
    expect(loaded[0].id).toBe(`t${RECENT_STORE_LIMIT + 4}`);
  });

  it("壊れた中身・知らない種類は読み飛ばす", () => {
    expect(loadRecent(memoryStorage("{not json"))).toEqual([]);
    expect(loadRecent(memoryStorage('{"kind":"trip"}'))).toEqual([]);
    const mixed = JSON.stringify([entry("trip", "trip1"), { kind: "weird", id: "x", at: 1 }, { kind: "trip", at: 1 }]);
    expect(loadRecent(memoryStorage(mixed))).toEqual([entry("trip", "trip1")]);
  });

  // プライベートブラウズなどでは localStorage に触るだけで例外になる。開く操作は止めない。
  it("保存できない端末でも落ちない", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(loadRecent(broken)).toEqual([]);
    expect(() => recordRecent({ kind: "trip", id: "trip1" }, broken, 1)).not.toThrow();
    expect(loadRecent(null)).toEqual([]);
  });
});

describe("recentEntryForPath", () => {
  it("旅行・メールの詳細は、そのものとして残す", () => {
    expect(recentEntryForPath("/trips/trip1")).toEqual({ kind: "trip", id: "trip1" });
    expect(recentEntryForPath("/gmail/mail/m1")).toEqual({ kind: "email", id: "m1" });
  });

  it("各画面は画面として残す(末尾の / は無視)", () => {
    expect(recentEntryForPath("/records/expense")).toEqual({ kind: "page", id: "/records/expense" });
    expect(recentEntryForPath("/settings/")).toEqual({ kind: "page", id: "/settings" });
  });

  it("ホーム・ログインの戻り先・知らないURLは残さない", () => {
    expect(recentEntryForPath("/")).toBeNull();
    expect(recentEntryForPath("/gmail/callback")).toBeNull();
    expect(recentEntryForPath("/auth/callback")).toBeNull();
    expect(recentEntryForPath("/nowhere")).toBeNull();
  });
});

describe("buildRecentList", () => {
  it("名前はいまのデータから引き、行き先は検索の当たりと同じ", () => {
    const items = buildRecentList([entry("trip", "trip1"), entry("email", "m1"), entry("event", "e1")], rows());
    expect(items.map((item) => [item.title, item.to])).toEqual([
      ["夏の京都", "/trips/trip1"],
      // メールは件名を出さない(第8弾 D-2)。
      ["Gmail のメール", "/gmail/mail/m1"],
      ["歯医者", "/schedule?view=list"],
    ]);
    // 予定の行は「誰の予定か」も持って出る。
    expect(items[2].personIds).toEqual(["p1"]);
    // 2行目の頭に、何の種類かを出す。
    expect(items[0].subtitle.startsWith("旅行")).toBe(true);
  });

  it("旅行の日程は、どの旅行のものかを添える", () => {
    const [item] = buildRecentList([entry("tripSchedule", "ts1")], rows());
    expect(item.subtitle).toContain("夏の京都");
    expect(item.to).toBe("/trips/trip1?tab=schedule");
  });

  it("消された・このアカウントに無いものは出さない", () => {
    const items = buildRecentList([entry("trip", "gone"), entry("email", "m1")], rows());
    expect(items.map((item) => item.entry.id)).toEqual(["m1"]);
  });

  it("画面は名前とアイコン付きで出す", () => {
    const [item] = buildRecentList([entry("page", "/records/expense")], rows());
    expect(item.title).toBe("お金管理");
    expect(item.to).toBe("/records/expense");
    expect(item.icon).toBeDefined();
  });

  it("いま開いている画面そのものは出さない", () => {
    const list = [entry("trip", "trip1"), entry("page", "/records/expense"), entry("email", "m1")];
    expect(buildRecentList(list, rows(), { currentPath: "/trips/trip1" }).map((i) => i.entry.id)).toEqual([
      "/records/expense",
      "m1",
    ]);
    expect(buildRecentList(list, rows(), { currentPath: "/records/expense" }).map((i) => i.entry.id)).toEqual([
      "trip1",
      "m1",
    ]);
  });

  it("画面は数を抑え、旅行やメールの場所を残す", () => {
    const list = [
      entry("page", "/schedule"),
      entry("page", "/records/expense"),
      entry("page", "/records/notes"),
      entry("page", "/gmail"),
      entry("trip", "trip1"),
    ];
    const items = buildRecentList(list, rows(), { pageLimit: 3 });
    expect(items.map((i) => i.entry.id)).toEqual(["/schedule", "/records/expense", "/records/notes", "trip1"]);
  });

  it("出す数には上限がある", () => {
    const many = Array.from({ length: 12 }, (_, i) => entry("trip", `t${i}`));
    const tripRows = new Map(many.map((e) => [e.id, { ...trip, id: e.id }]));
    expect(buildRecentList(many, rows({ trips: tripRows }), { limit: 8 })).toHaveLength(8);
  });
});
