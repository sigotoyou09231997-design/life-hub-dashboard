// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Dexieの代わりに、このテストが使う操作(toArray / update / delete /
 * where().equals().toArray|first|count|modify())だけを持つ配列ベースの最小テーブル。 */
function fakeTable<T extends { id?: string }>(rows: T[]) {
  const table = {
    rows,
    toArray: async () => [...table.rows],
    update: async (id: string, changes: Partial<T>) => {
      const row = table.rows.find((r) => r.id === id);
      if (row) Object.assign(row, changes);
    },
    delete: async (id: string) => {
      table.rows = table.rows.filter((row) => row.id !== id);
    },
    where(field: keyof T) {
      return {
        equals(value: unknown) {
          const matching = () => table.rows.filter((row) => row[field] === value);
          return {
            toArray: async () => matching(),
            first: async () => matching()[0],
            count: async () => matching().length,
            modify: async (changes: Partial<T>) => {
              for (const row of matching()) Object.assign(row, changes);
            },
          };
        },
      };
    },
  };
  return table;
}

const mocks = vi.hoisted(() => ({ db: {} as Record<string, unknown> }));
vi.mock("../db/schema", () => ({ db: mocks.db }));

import {
  consolidateGmailAccounts,
  readSelectedGmailAccountId,
  rememberSelectedGmailAccountId,
  resolveSelectedGmailAccountId,
} from "./gmailAccounts";

function setupDb(options: {
  accounts: { id: string; email: string; connectedAt: number }[];
  emails: { id: string; accountId: string; gmailMessageId?: string; status?: string; createdAt?: number }[];
  drafts?: { id: string; accountId: string; emailId?: string }[];
  blocked?: { id: string; accountId: string; email: string }[];
}) {
  const tables = {
    gmailAccounts: fakeTable(options.accounts),
    syncedEmails: fakeTable(options.emails),
    draftReplies: fakeTable(options.drafts ?? []),
    blockedSenders: fakeTable(options.blocked ?? []),
  };
  Object.assign(mocks.db, tables);
  return tables;
}

describe("consolidateGmailAccounts", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.db)) delete mocks.db[key];
  });

  it("同じアドレスの重複アカウントを、最後に連携した1行にまとめる", async () => {
    const tables = setupDb({
      accounts: [
        { id: "old", email: "me@example.com", connectedAt: 1_000 },
        { id: "new", email: "me@example.com", connectedAt: 2_000 },
      ],
      emails: [
        { id: "mail-1", accountId: "old", gmailMessageId: "g-1", status: "unprocessed", createdAt: 1 },
        { id: "mail-2", accountId: "new", gmailMessageId: "g-2", status: "unprocessed", createdAt: 2 },
      ],
      drafts: [{ id: "draft-1", accountId: "old", emailId: "mail-1" }],
      blocked: [
        { id: "block-1", accountId: "old", email: "spam@example.com" },
        { id: "block-2", accountId: "new", email: "spam@example.com" },
      ],
    });

    expect(await consolidateGmailAccounts()).toBe(1);
    expect(tables.gmailAccounts.rows.map((a) => a.id)).toEqual(["new"]);
    // 古い行のメール・下書きは消さずに、残した行へ付け替える。
    expect(tables.syncedEmails.rows.every((e) => e.accountId === "new")).toBe(true);
    expect(tables.draftReplies.rows.every((d) => d.accountId === "new")).toBe(true);
    // 付け替えで同じ送信者が2行になるので1行に落とす。
    expect(tables.blockedSenders.rows).toHaveLength(1);
  });

  it("どのアカウントにも属さないメール・下書き・ブロックリストを消す", async () => {
    const tables = setupDb({
      accounts: [{ id: "live", email: "me@example.com", connectedAt: 1_000 }],
      emails: [
        { id: "mail-1", accountId: "live", gmailMessageId: "g-1", status: "unprocessed", createdAt: 1 },
        { id: "mail-orphan", accountId: "gone", gmailMessageId: "g-2", status: "unprocessed", createdAt: 2 },
      ],
      drafts: [{ id: "draft-orphan", accountId: "gone", emailId: "mail-orphan" }],
      blocked: [{ id: "block-orphan", accountId: "gone", email: "spam@example.com" }],
    });

    expect(await consolidateGmailAccounts()).toBe(0);
    expect(tables.syncedEmails.rows.map((e) => e.id)).toEqual(["mail-1"]);
    expect(tables.draftReplies.rows).toHaveLength(0);
    expect(tables.blockedSenders.rows).toHaveLength(0);
  });

  it("重複が無ければ何も変えない", async () => {
    const tables = setupDb({
      accounts: [
        { id: "a", email: "me@example.com", connectedAt: 1_000 },
        { id: "b", email: "other@example.com", connectedAt: 2_000 },
      ],
      emails: [{ id: "mail-1", accountId: "a", gmailMessageId: "g-1", status: "unprocessed", createdAt: 1 }],
    });

    expect(await consolidateGmailAccounts()).toBe(0);
    expect(tables.gmailAccounts.rows).toHaveLength(2);
    expect(tables.syncedEmails.rows).toHaveLength(1);
  });

  // 実際に起きた不具合: 連携し直しで2つになったアカウントが、それぞれ同じ受信トレイを
  // 取り込んでいたため、1つにまとめた時点でまったく同じメールが一覧に二重で並んだ。
  it("まとめた先で同じメールが2行になったら、1行に畳む", async () => {
    const tables = setupDb({
      accounts: [
        { id: "old", email: "me@example.com", connectedAt: 1_000 },
        { id: "new", email: "me@example.com", connectedAt: 2_000 },
      ],
      emails: [
        { id: "mail-old", accountId: "old", gmailMessageId: "same", status: "drafted", createdAt: 1 },
        { id: "mail-new", accountId: "new", gmailMessageId: "same", status: "unprocessed", createdAt: 2 },
      ],
      drafts: [{ id: "draft-1", accountId: "old", emailId: "mail-old" }],
    });

    expect(await consolidateGmailAccounts()).toBe(1);
    // AI下書きを持っている方(進んでいる方)を残す。
    expect(tables.syncedEmails.rows.map((e) => e.id)).toEqual(["mail-old"]);
    expect(tables.draftReplies.rows).toEqual([{ id: "draft-1", accountId: "new", emailId: "mail-old" }]);
  });
});

describe("選択中のGmailアカウントの記憶", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("覚えたIDをそのまま読み戻せる", () => {
    expect(readSelectedGmailAccountId()).toBeNull();
    rememberSelectedGmailAccountId("account-b");
    expect(readSelectedGmailAccountId()).toBe("account-b");
  });

  it("覚えていたアカウントがまだあれば、それを選んだままにする", () => {
    expect(resolveSelectedGmailAccountId([{ id: "account-a" }, { id: "account-b" }], "account-b")).toBe("account-b");
  });

  it("覚えていたアカウントが無くなっていたら1件目に戻す", () => {
    // 連携を解除した後や、別のアカウントに切り替えた後の状態。
    expect(resolveSelectedGmailAccountId([{ id: "account-a" }], "account-gone")).toBe("account-a");
  });

  it("まだ何も覚えていなければ1件目を選ぶ", () => {
    expect(resolveSelectedGmailAccountId([{ id: "account-a" }, { id: "account-b" }], null)).toBe("account-a");
  });

  it("連携アカウントが1件も無ければ何も選ばない", () => {
    expect(resolveSelectedGmailAccountId([], "account-a")).toBeNull();
  });
});
