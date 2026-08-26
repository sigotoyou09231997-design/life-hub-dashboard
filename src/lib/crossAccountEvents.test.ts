import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../types";
import type { StoredAccount } from "./accounts";

const mocks = vi.hoisted(() => {
  interface Store {
    events: Record<string, unknown>[];
    queue: Record<string, unknown>[];
    opened: number;
    closed: number;
  }
  const stores = new Map<string, Store>();
  return {
    accounts: [] as StoredAccount[],
    /** いま開いているIndexedDBの名前。どのアカウントで動いているかの実体。 */
    bootDbName: "life-hub",
    stores,
    storeFor(dbName: string): Store {
      const existing = stores.get(dbName);
      if (existing) return existing;
      const created: Store = { events: [], queue: [], opened: 0, closed: 0 };
      stores.set(dbName, created);
      return created;
    },
  };
});

// Dexieの実体(IndexedDB)はテストでは開けないので、このテストが使う操作だけを持つ
// 配列ベースの偽DBに差し替える。DB名ごとに中身を分けて持つ。
vi.mock("../db/schema", () => {
  let queueId = 0;
  function fakeTable(rows: Record<string, unknown>[]) {
    const matches = (row: Record<string, unknown>, field: string, value: unknown) =>
      field === "[table+rowId]"
        ? row.table === (value as unknown[])[0] && row.rowId === (value as unknown[])[1]
        : row[field] === value;
    return {
      add: async (row: Record<string, unknown>) => {
        const withId = { ...row, id: row.id ?? ++queueId };
        rows.push(withId);
        return withId.id;
      },
      update: async (id: unknown, changes: Record<string, unknown>) => {
        const found = rows.find((row) => row.id === id);
        if (found) Object.assign(found, changes);
        return found ? 1 : 0;
      },
      delete: async (id: unknown) => {
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) rows.splice(index, 1);
      },
      where: (field: string) => ({
        equals: (value: unknown) => ({
          first: async () => rows.find((row) => matches(row, field, value)),
          toArray: async () => rows.filter((row) => matches(row, field, value)),
        }),
      }),
    };
  }
  return {
    LifeHubDB: class {
      dbName: string;
      calendarEvents: ReturnType<typeof fakeTable>;
      syncQueue: ReturnType<typeof fakeTable>;
      constructor(dbName: string) {
        this.dbName = dbName;
        const store = mocks.storeFor(dbName);
        this.calendarEvents = fakeTable(store.events);
        this.syncQueue = fakeTable(store.queue);
      }
      async open() {
        mocks.storeFor(this.dbName).opened += 1;
        return this;
      }
      close() {
        mocks.storeFor(this.dbName).closed += 1;
      }
    },
  };
});
vi.mock("./deviceId", () => ({ getDeviceId: () => "device-1" }));
vi.mock("./accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounts")>()),
  listAccounts: () => mocks.accounts,
  // 起動時に決まる定数なので、テストごとに差し替えられるようgetterで見せる。
  get BOOT_DB_NAME() {
    return mocks.bootDbName;
  },
}));

import {
  applyEventToAccount,
  emptyDrafts,
  findLinkedEvent,
  followMainTitle,
  listOtherAccounts,
  planAccountChanges,
  removeEventFromAccount,
  type AccountEventDraft,
  type OtherAccount,
} from "./crossAccountEvents";

const storedAccount = (userId: string, name: string | null, email: string | null): StoredAccount => ({
  userId,
  email,
  name,
  avatarUrl: null,
  slot: null,
  dbName: `life-hub-${userId}`,
  addedAt: 0,
});

const other = (userId: string, label: string): OtherAccount => ({
  userId,
  dbName: `life-hub-${userId}`,
  label,
  email: null,
});

const draft = (over: Partial<AccountEventDraft>): AccountEventDraft => ({
  checked: false,
  title: "",
  edited: false,
  existed: false,
  ...over,
});

beforeEach(() => {
  mocks.accounts = [];
  mocks.bootDbName = "life-hub";
  mocks.stores.clear();
});

describe("listOtherAccounts", () => {
  it("いま開いているアカウントは複製先に出さない", () => {
    mocks.accounts = [storedAccount("me", "自分", "me@example.com"), storedAccount("work", "仕事用", "work@example.com")];
    mocks.bootDbName = "life-hub-me";
    expect(listOtherAccounts().map((a) => a.userId)).toEqual(["work"]);
  });

  it("1つ目のアカウント(既定のDB)から見ても、あとから足した方が複製先に出る", () => {
    // 1つ目だけ欄が出なかった不具合の再発防止。1つ目はDB名が既定値("life-hub")、
    // slotもnullで、2つ目以降と形が違う唯一のアカウント。
    mocks.accounts = [
      { ...storedAccount("me", "自分", "me@example.com"), dbName: "life-hub", slot: null },
      storedAccount("work", "仕事用", "work@example.com"),
    ];
    mocks.bootDbName = "life-hub";
    expect(listOtherAccounts().map((a) => a.userId)).toEqual(["work"]);
  });

  it("アカウントが1つだけなら複製先は無い(欄そのものを出さない)", () => {
    mocks.accounts = [storedAccount("me", "自分", "me@example.com")];
    mocks.bootDbName = "life-hub-me";
    expect(listOtherAccounts()).toEqual([]);
  });

  it("表示名が無ければメールアドレスを名前に使う", () => {
    mocks.accounts = [storedAccount("me", "自分", null), storedAccount("work", null, "work@example.com")];
    mocks.bootDbName = "life-hub-me";
    expect(listOtherAccounts()[0].label).toBe("work@example.com");
  });
});

describe("followMainTitle", () => {
  it("まだ書き換えていない行は、上のタイトルに追従する", () => {
    const drafts = emptyDrafts([other("work", "仕事用")], "面接");
    expect(followMainTitle(drafts, "○○社 面接").work.title).toBe("○○社 面接");
  });

  it("個別に書き換えた行は、上を直しても戻さない", () => {
    // 「会社名はこっちのアカウントには出したくない」で付けた名前を守る。
    const drafts = { work: draft({ checked: true, title: "面接", edited: true }) };
    expect(followMainTitle(drafts, "○○社 面接").work.title).toBe("面接");
  });
});

describe("emptyDrafts", () => {
  it("既定はオフ。押した時だけ相手のアカウントに入る", () => {
    expect(emptyDrafts([other("work", "仕事用")], "面接").work.checked).toBe(false);
  });
});

describe("planAccountChanges", () => {
  const accounts = [other("work", "仕事用"), other("private", "プライベート")];

  it("チェックを入れたアカウントだけを、その名前で反映する", () => {
    const drafts = {
      work: draft({ checked: true, title: "面接", edited: true }),
      private: draft({ title: "○○社 面接" }),
    };
    expect(planAccountChanges(accounts, drafts, "○○社 面接")).toEqual({
      apply: [{ account: accounts[0], title: "面接" }],
      remove: [],
    });
  });

  it("入っていたのにチェックを外したら、そのアカウントから取り下げる", () => {
    const drafts = { work: draft({ checked: false, existed: true }), private: draft({}) };
    expect(planAccountChanges(accounts, drafts, "面接")).toEqual({ apply: [], remove: [accounts[0]] });
  });

  it("元から入っていないアカウントは、外れていても何もしない", () => {
    expect(planAccountChanges(accounts, emptyDrafts(accounts, "面接"), "面接")).toEqual({ apply: [], remove: [] });
  });

  it("名前を空にしたら、上のタイトルをそのまま使う", () => {
    const drafts = { work: draft({ checked: true, title: "   ", edited: true }), private: draft({}) };
    expect(planAccountChanges(accounts, drafts, "○○社 面接").apply[0].title).toBe("○○社 面接");
  });
});

describe("applyEventToAccount", () => {
  const event: CalendarEvent = {
    id: "local-row",
    title: "○○社 面接",
    date: "2026-09-01",
    startTime: "10:00",
    category: "other",
    createdAt: 1_000,
    userId: "me",
    deviceId: "device-1",
  };

  it("相手のアカウントのDBに書き、その持ち主として記録する", async () => {
    await applyEventToAccount(other("work", "仕事用"), event, "link-1", "面接");
    const store = mocks.storeFor("life-hub-work");
    expect(store.events).toHaveLength(1);
    // 書いた側(me)ではなく、入れた先のアカウントの持ち物にする。ここを間違えると
    // 相手のアカウントで同期した時にサーバー側から弾かれる。
    expect(store.events[0].userId).toBe("work");
    expect(store.events[0].deviceId).toBe("device-1");
    expect(store.events[0].linkId).toBe("link-1");
    // 予定名だけは相手側の値を使う。
    expect(store.events[0].title).toBe("面接");
  });

  it("こちらの行のidは持ち込まず、新しいidを振る", async () => {
    await applyEventToAccount(other("work", "仕事用"), event, "link-1", "面接");
    expect(mocks.storeFor("life-hub-work").events[0].id).not.toBe("local-row");
  });

  it("2回目からは足さずに直す(行き来して編集しても増えない)", async () => {
    const work = other("work", "仕事用");
    await applyEventToAccount(work, event, "link-1", "面接");
    await applyEventToAccount(work, { ...event, startTime: "20:30", endTime: "21:30" }, "link-1", "面接");

    const store = mocks.storeFor("life-hub-work");
    expect(store.events).toHaveLength(1);
    expect(store.events[0].startTime).toBe("20:30");
    expect(store.events[0].endTime).toBe("21:30");
    // 相手側で付けている予定名は、日時を直しても保たれる。
    expect(store.events[0].title).toBe("面接");
  });

  it("相手のDBの同期キューに、同期エンジンが知っている名前で積む", async () => {
    // "calendarEvents" のようなDexie側の名前で積むと、同期エンジンは知らないキューとして
    // 黙って捨ててしまい、相手のアカウントの他の端末には一生上がらない。
    await applyEventToAccount(other("work", "仕事用"), event, "link-1", "面接");
    const store = mocks.storeFor("life-hub-work");
    expect(store.queue).toHaveLength(1);
    expect(store.queue[0].table).toBe("calendar_events");
    expect(store.queue[0].rowId).toBe(store.events[0].id);
    expect(store.queue[0].op).toBe("upsert");
  });

  it("同じ行を2回直しても、同期キューは1本にまとめる", async () => {
    const work = other("work", "仕事用");
    await applyEventToAccount(work, event, "link-1", "面接");
    await applyEventToAccount(work, event, "link-1", "面接");
    expect(mocks.storeFor("life-hub-work").queue).toHaveLength(1);
  });

  it("書き終わったら相手のDBを閉じる", async () => {
    await applyEventToAccount(other("work", "仕事用"), event, "link-1", "面接");
    expect(mocks.storeFor("life-hub-work").closed).toBe(1);
  });

  it("いま開いているDBには書き戻さない", async () => {
    // ここを許すと、複製したつもりの予定が自分のスケジュールに増える。
    await expect(
      applyEventToAccount({ userId: "me", dbName: "life-hub", label: "自分", email: null }, event, "link-1", "面接"),
    ).rejects.toThrow(/いま開いているアカウントと同じ/);
    expect(mocks.stores.has("life-hub")).toBe(false);
  });
});

describe("findLinkedEvent", () => {
  it("入れた先のアカウントにある「同じ予定」を見つける", async () => {
    const work = other("work", "仕事用");
    await applyEventToAccount(work, { title: "○○社 面接", date: "2026-09-01", createdAt: 0 }, "link-1", "面接");
    const found = await findLinkedEvent(work, "link-1");
    expect(found?.title).toBe("面接");
  });

  it("入っていなければ null", async () => {
    expect(await findLinkedEvent(other("work", "仕事用"), "link-1")).toBeNull();
  });
});

describe("removeEventFromAccount", () => {
  it("チェックを外したアカウントから取り下げ、削除として同期に積む", async () => {
    const work = other("work", "仕事用");
    await applyEventToAccount(work, { title: "面接", date: "2026-09-01", createdAt: 0 }, "link-1", "面接");
    const rowId = mocks.storeFor("life-hub-work").events[0].id;

    await removeEventFromAccount(work, "link-1");

    const store = mocks.storeFor("life-hub-work");
    expect(store.events).toEqual([]);
    expect(store.queue).toEqual([{ id: expect.anything(), table: "calendar_events", rowId, op: "delete", queuedAt: expect.any(Number) }]);
  });

  it("相手側に無ければ何もしない", async () => {
    await removeEventFromAccount(other("work", "仕事用"), "link-1");
    expect(mocks.storeFor("life-hub-work").queue).toEqual([]);
  });
});
