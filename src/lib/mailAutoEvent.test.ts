import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  settings: [] as { id: string; autoEventEnabled?: boolean }[],
  emails: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  links: [] as Record<string, unknown>[],
}));

vi.mock("../db/schema", () => ({
  db: {
    settings: { toCollection: () => ({ first: async () => store.settings[0] }) },
    syncedEmails: {
      where: () => ({ equals: (accountId: string) => ({ toArray: async () => store.emails.filter((e) => e.accountId === accountId) }) }),
      update: async (id: string, patch: Record<string, unknown>) => {
        const row = store.emails.find((e) => e.id === id);
        if (row) Object.assign(row, patch);
      },
    },
    calendarEvents: {
      get: async (id: string) => store.events.find((e) => e.id === id),
      where: () => ({ equals: (date: string) => ({ toArray: async () => store.events.filter((e) => e.date === date) }) }),
      put: async (row: Record<string, unknown>) => {
        const at = store.events.findIndex((e) => e.id === row.id);
        if (at >= 0) store.events[at] = row;
        else store.events.push(row);
      },
    },
    eventMailLinks: { put: async (row: Record<string, unknown>) => void store.links.push(row) },
  },
}));

// 本物の stableUuid は SHA-256 を使う。ここでは、同じ入力なら同じ値が返ることだけ分かればよい。
vi.mock("./googleCalendar", () => ({ stableUuid: async (seed: string) => `uuid:${seed}` }));

import { autoAddConfirmedEvents, detectConfirmedSchedule, readTimeRange } from "./mailAutoEvent";

// 日本時間 2026-11-21 13:00。受信時刻もこの前後で作る。
const NOW = new Date("2026-11-21T13:00:00+09:00").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  store.settings = [{ id: "s1" }];
  store.emails = [];
  store.events = [];
  store.links = [];
});
afterEach(() => vi.useRealTimers());

function mail(over: Record<string, unknown> = {}) {
  return {
    subject: "【面接日程確定】株式会社テスト 一次面接のご案内",
    snippet: "面接の日時が確定しました。11月25日（水）19:30〜20:30 オンライン",
    status: "unprocessed" as const,
    receivedAt: NOW - 60 * 60 * 1000,
    ...over,
  };
}

describe("readTimeRange", () => {
  it("14:30 / 全角 / 午後7時30分 / 10時半 を読む", () => {
    expect(readTimeRange("14:30 から")?.start).toBe("14:30");
    expect(readTimeRange("19:30 から")?.start).toBe("19:30");
    expect(readTimeRange("午後7時30分に")?.start).toBe("19:30");
    expect(readTimeRange("10時半に")?.start).toBe("10:30");
    expect(readTimeRange("午前12時")?.start).toBe("00:00");
  });
  it("「19:30〜20:30」は終わりの時刻も読む。逆順や読めない終わりは捨てる", () => {
    expect(readTimeRange("19:30〜20:30")).toEqual({ start: "19:30", end: "20:30" });
    expect(readTimeRange("19:30～")).toEqual({ start: "19:30", end: undefined });
    expect(readTimeRange("19:30〜18:00")).toEqual({ start: "19:30", end: undefined });
  });
  it("「1時間」は時刻ではない。25時のような時刻も読まない", () => {
    expect(readTimeRange("所要1時間程度")).toBeUndefined();
    expect(readTimeRange("25時に")).toBeUndefined();
  });
});

describe("detectConfirmedSchedule — 入れるもの", () => {
  it("日時が確定したと書いてあり、日付が1日で時刻もある面接のメールを読み取る", () => {
    expect(detectConfirmedSchedule(mail(), NOW)).toEqual({
      date: "2026-11-25",
      startTime: "19:30",
      endTime: "20:30",
      title: "面接日程確定 株式会社テスト 一次面接のご案内",
      reason: "確定・面接",
    });
  });
  it("終わりの時刻が無ければ1時間で置く。23時台は日をまたがない", () => {
    const a = detectConfirmedSchedule(mail({ snippet: "面接が確定しました。11月25日 14:00 から" }), NOW);
    expect(a?.endTime).toBe("15:00");
    const b = detectConfirmedSchedule(mail({ snippet: "面接が確定しました。11月25日 23:30 から" }), NOW);
    expect(b?.endTime).toBe("23:59");
  });
  it("予約完了のメール(診察・健診)も入れる", () => {
    const found = detectConfirmedSchedule(
      mail({ subject: "ご予約完了のお知らせ", snippet: "健診 11月30日(月) 10:00 のご予約を承りました" }),
      NOW,
    );
    expect(found).toMatchObject({ date: "2026-11-30", startTime: "10:00", endTime: "11:00" });
  });
  it("本文の頭(planText)にしか日時が無いメールも読む。件名に予定の言葉が無ければ頭に添える", () => {
    const found = detectConfirmedSchedule(
      mail({
        subject: "応募先の企業からメッセージが届きました",
        snippet: "企業からメッセージが届きました。",
        planText: "面接日程が確定しました。2026年11月26日 19:30 より Web面接を行います。",
      }),
      NOW,
    );
    expect(found).toMatchObject({ date: "2026-11-26", startTime: "19:30", title: "面接: 応募先の企業からメッセージが届きました" });
  });
});

describe("detectConfirmedSchedule — 入れないもの", () => {
  it("実際のトップクラウドの案内: 候補を出して「いかがでしょうか」、確定は「確定しましたら」(これから)", () => {
    const found = detectConfirmedSchedule(
      mail({
        subject: "Re:【面接日程調整のお願い】",
        snippet: "",
        planText:
          "下記の日程はいかがでしょうか。11月25日（水）19：30～（1時間程度想定）日程が確定しましたら、URLをお送り致します。",
      }),
      NOW,
    );
    expect(found).toBeNull();
  });
  it("「確定しましたら」だけなら確定とは読まない(候補の言葉が無くても)", () => {
    expect(detectConfirmedSchedule(mail({ subject: "面接のご案内", snippet: "面接は 11月25日 19:30 です。日程が確定しましたらご連絡します" }), NOW)).toBeNull();
    expect(detectConfirmedSchedule(mail({ subject: "面接のご案内", snippet: "面接は 11月25日 19:30 です。確定次第お知らせします" }), NOW)).toBeNull();
  });
  it("候補を並べて選ばせるメール・日付が2日以上のメール", () => {
    expect(detectConfirmedSchedule(mail({ snippet: "面接の候補日 11月25日 19:30 / 11月26日 19:30 確定したらご連絡を" }), NOW)).toBeNull();
    expect(detectConfirmedSchedule(mail({ snippet: "面接が確定しました。11月25日 19:30 または 11月26日 19:30" }), NOW)).toBeNull();
  });
  it("時刻が無い・もう過ぎた日付・予定の種類が無い(注文確定など)・宣伝", () => {
    expect(detectConfirmedSchedule(mail({ snippet: "面接が確定しました。11月25日" }), NOW)).toBeNull();
    expect(detectConfirmedSchedule(mail({ snippet: "面接が確定しました。11月20日 19:30" }), NOW)).toBeNull();
    expect(detectConfirmedSchedule(mail({ subject: "ご注文確定", snippet: "11月25日 19:30 にお届けします" }), NOW)).toBeNull();
    expect(detectConfirmedSchedule(mail({ snippet: "セール 面接が確定 11月25日 19:30" }), NOW)).toBeNull();
  });
  it("3日より古いメール・もう入れた/あとでにしたメール・スキップしたメール", () => {
    const old = NOW - 4 * 24 * 60 * 60 * 1000;
    expect(detectConfirmedSchedule(mail({ receivedAt: old }), NOW)).toBeNull();
    expect(detectConfirmedSchedule(mail({ autoEventAt: NOW }), NOW)).toBeNull();
    expect(detectConfirmedSchedule(mail({ planSuggestionDismissedAt: NOW }), NOW)).toBeNull();
    expect(detectConfirmedSchedule(mail({ status: "skipped" }), NOW)).toBeNull();
  });
});

describe("autoAddConfirmedEvents", () => {
  const account = { email: "me@example.com" };
  function addMail(over: Record<string, unknown> = {}) {
    store.emails.push({ id: "e1", accountId: "a1", gmailMessageId: "m1", threadId: "t1", from: "hr@example.com", ...mail(over) });
  }

  it("確定したメールを予定に入れ、元メールへのリンクを残し、候補から外す", async () => {
    addMail();
    const titles = await autoAddConfirmedEvents(account, "a1", NOW);
    expect(titles).toEqual(["面接日程確定 株式会社テスト 一次面接のご案内"]);
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({
      id: "uuid:mail-auto-event:me@example.com:m1",
      date: "2026-11-25",
      startTime: "19:30",
      endTime: "20:30",
      allDay: false,
    });
    expect(String(store.events[0].memo)).toContain("メールから自動で入れました");
    expect(store.links[0]).toMatchObject({ eventId: store.events[0].id, gmailMessageId: "m1", accountEmail: "me@example.com" });
    expect(store.emails[0]).toMatchObject({ autoEventAt: NOW, planSuggestionDismissedAt: NOW });
  });

  it("2回目の同期では入れ直さない。本人が予定を消しても戻さない", async () => {
    addMail();
    await autoAddConfirmedEvents(account, "a1", NOW);
    store.events = [];
    expect(await autoAddConfirmedEvents(account, "a1", NOW + 60_000)).toEqual([]);
    expect(store.events).toHaveLength(0);
  });

  it("本人が先に同じ日・同じ時刻に入れていたら、二重にしない(見たことだけ覚える)", async () => {
    store.events.push({ id: "manual", title: "トップクラウド 面接", date: "2026-11-25", startTime: "19:30", allDay: false });
    addMail();
    expect(await autoAddConfirmedEvents(account, "a1", NOW)).toEqual([]);
    expect(store.events).toHaveLength(1);
    expect(store.emails[0].autoEventAt).toBe(NOW);
  });

  it("設定で切ってあれば何もしない。未設定はON", async () => {
    addMail();
    store.settings = [{ id: "s1", autoEventEnabled: false }];
    expect(await autoAddConfirmedEvents(account, "a1", NOW)).toEqual([]);
    expect(store.events).toHaveLength(0);
    store.settings = [];
    expect(await autoAddConfirmedEvents(account, "a1", NOW)).toHaveLength(1);
  });

  it("別のアカウントのメールは見ない。確定でないメールは何もしない", async () => {
    store.emails.push({ id: "e2", accountId: "other", gmailMessageId: "m2", threadId: "t", from: "x", ...mail() });
    addMail({ subject: "お知らせ", snippet: "来週お会いしましょう" });
    expect(await autoAddConfirmedEvents(account, "a1", NOW)).toEqual([]);
    expect(store.events).toHaveLength(0);
  });
});
