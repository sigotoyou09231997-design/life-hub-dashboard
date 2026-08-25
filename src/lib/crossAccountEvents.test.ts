import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../types";
import type { StoredAccount } from "./accounts";

const mocks = vi.hoisted(() => ({
  accounts: [] as StoredAccount[],
  activeUserId: null as string | null,
  /** いま開いているIndexedDBの名前。どのアカウントで動いているかの実体。 */
  bootDbName: "life-hub",
  /** 相手のDBに実際に書かれた内容。openした順に1件ずつ入る。 */
  opened: [] as {
    dbName: string;
    events: Record<string, unknown>[];
    queued: Record<string, unknown>[];
    closed: boolean;
  }[],
}));

// Dexieの実体(IndexedDB)はテストでは開けないので、書き込み先を記録するだけの偽DBに
// 差し替える。確かめたいのは「どのDBに、何を書いて、同期に積んだか」。
vi.mock("../db/schema", () => ({
  LifeHubDB: class {
    private record: (typeof mocks.opened)[number];
    calendarEvents: { add: (row: Record<string, unknown>) => Promise<string> };
    syncQueue: { add: (row: Record<string, unknown>) => Promise<number> };

    constructor(dbName: string) {
      this.record = { dbName, events: [], queued: [], closed: false };
      mocks.opened.push(this.record);
      this.calendarEvents = {
        add: async (row) => {
          this.record.events.push(row);
          return String(row.id);
        },
      };
      this.syncQueue = {
        add: async (row) => {
          this.record.queued.push(row);
          return 1;
        },
      };
    }

    async open() {
      return this;
    }

    close() {
      this.record.closed = true;
    }
  },
}));
vi.mock("./deviceId", () => ({ getDeviceId: () => "device-1" }));
vi.mock("./accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounts")>()),
  listAccounts: () => mocks.accounts,
  getActiveAccount: () => mocks.accounts.find((a) => a.userId === mocks.activeUserId) ?? null,
  // 起動時に決まる定数なので、テストごとに差し替えられるようgetterで見せる。
  get BOOT_DB_NAME() {
    return mocks.bootDbName;
  },
}));

import {
  addEventToAccount,
  emptyDrafts,
  followMainTitle,
  listOtherAccounts,
  planAccountEvents,
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

describe("listOtherAccounts", () => {
  beforeEach(() => {
    mocks.accounts = [];
    mocks.activeUserId = null;
    mocks.bootDbName = "life-hub";
  });

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

  it("切り替え用のポインタが実際に開いているDBと食い違っていても、DBの方を信じる", () => {
    // ポインタ(lifeHubActiveAccount)は切り替え直後や追加ログインの途中でずれることが
    // ある。ずれた側を信じると、自分自身を複製先に出してしまう。
    mocks.accounts = [storedAccount("me", "自分", "me@example.com"), storedAccount("work", "仕事用", "work@example.com")];
    mocks.bootDbName = "life-hub-me";
    mocks.activeUserId = "work";
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
    const drafts: Record<string, AccountEventDraft> = {
      work: { checked: true, title: "面接", edited: true },
    };
    expect(followMainTitle(drafts, "○○社 面接").work.title).toBe("面接");
  });
});

describe("emptyDrafts", () => {
  it("既定はオフ。押した時だけ相手のアカウントに入る", () => {
    // 既定でオンにすると、片方だけに入れたい普段の予定まで黙って両方に増えてしまう。
    expect(emptyDrafts([other("work", "仕事用")], "面接").work.checked).toBe(false);
  });
});

describe("planAccountEvents", () => {
  const accounts = [other("work", "仕事用"), other("private", "プライベート")];

  it("チェックを入れたアカウントだけを、その名前で書き込む", () => {
    const drafts: Record<string, AccountEventDraft> = {
      work: { checked: true, title: "面接", edited: true },
      private: { checked: false, title: "○○社 面接", edited: false },
    };
    expect(planAccountEvents(accounts, drafts, "○○社 面接")).toEqual([
      { account: accounts[0], title: "面接" },
    ]);
  });

  it("名前を空にしたら、上のタイトルをそのまま使う", () => {
    const drafts: Record<string, AccountEventDraft> = {
      work: { checked: true, title: "   ", edited: true },
      private: { checked: false, title: "", edited: false },
    };
    expect(planAccountEvents(accounts, drafts, "○○社 面接")[0].title).toBe("○○社 面接");
  });

  it("どれもチェックしていなければ何も書き込まない", () => {
    expect(planAccountEvents(accounts, emptyDrafts(accounts, "面接"), "面接")).toEqual([]);
  });
});

describe("addEventToAccount", () => {
  const event: CalendarEvent = {
    title: "面接",
    date: "2026-09-01",
    allDay: false,
    startTime: "10:00",
    category: "other",
    createdAt: 1_000,
    id: "local-row",
    userId: "me",
    deviceId: "device-1",
  };

  beforeEach(() => {
    mocks.opened = [];
  });

  it("相手のアカウントのDBに書き、その持ち主として記録する", async () => {
    await addEventToAccount(other("work", "仕事用"), { ...event, title: "面接" });
    const [written] = mocks.opened;
    expect(written.dbName).toBe("life-hub-work");
    expect(written.events).toHaveLength(1);
    // 書いた側(me)ではなく、入れた先のアカウントの持ち物にする。ここを間違えると
    // 相手のアカウントで同期した時にサーバー側から弾かれる。
    expect(written.events[0].userId).toBe("work");
    expect(written.events[0].deviceId).toBe("device-1");
    expect(written.events[0].title).toBe("面接");
  });

  it("こちらの行のidは持ち込まず、新しいidを振る", async () => {
    await addEventToAccount(other("work", "仕事用"), event);
    expect(mocks.opened[0].events[0].id).not.toBe("local-row");
    expect(mocks.opened[0].events[0].id).toEqual(expect.any(String));
  });

  it("相手のDBの同期キューに積む(切り替えた時に他の端末へ上がるように)", async () => {
    // 同期のフックは「いま開いているDB」にしか付いていないので、ここで積まないと
    // その予定はこの端末の中だけに残る。
    await addEventToAccount(other("work", "仕事用"), event);
    const written = mocks.opened[0];
    expect(written.queued).toEqual([
      { table: "calendarEvents", rowId: written.events[0].id, op: "upsert", queuedAt: expect.any(Number) },
    ]);
  });

  it("書き終わったら相手のDBを閉じる", async () => {
    await addEventToAccount(other("work", "仕事用"), event);
    expect(mocks.opened[0].closed).toBe(true);
  });
});
