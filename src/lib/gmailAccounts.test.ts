import { beforeEach, describe, expect, it, vi } from "vitest";

/** Dexieの代わりに、このテストが使う操作(toArray / delete / where().equals().modify())
 * だけを持つ配列ベースの最小テーブル。 */
function fakeTable<T extends { id?: string }>(rows: T[]) {
  const table = {
    rows,
    toArray: async () => [...table.rows],
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

import { consolidateGmailAccounts } from "./gmailAccounts";

function setupDb(options: {
  accounts: { id: string; email: string; connectedAt: number }[];
  emails: { id: string; accountId: string }[];
  drafts?: { id: string; accountId: string }[];
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
        { id: "mail-1", accountId: "old" },
        { id: "mail-2", accountId: "new" },
      ],
      drafts: [{ id: "draft-1", accountId: "old" }],
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
        { id: "mail-1", accountId: "live" },
        { id: "mail-orphan", accountId: "gone" },
      ],
      drafts: [{ id: "draft-orphan", accountId: "gone" }],
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
      emails: [{ id: "mail-1", accountId: "a" }],
    });

    expect(await consolidateGmailAccounts()).toBe(0);
    expect(tables.gmailAccounts.rows).toHaveLength(2);
    expect(tables.syncedEmails.rows).toHaveLength(1);
  });
});
