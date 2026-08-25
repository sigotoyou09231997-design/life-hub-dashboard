import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncedEmail } from "../types";

/** Dexieの代わりに、このテストが使う操作だけを持つ配列ベースの最小テーブル。 */
function fakeTable<T extends { id?: string }>(rows: T[]) {
  const table = {
    rows,
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
          };
        },
      };
    },
  };
  return table;
}

const mocks = vi.hoisted(() => ({ db: {} as Record<string, unknown> }));
vi.mock("../db/schema", () => ({ db: mocks.db }));

import { dedupeSyncedEmails, mergeDuplicateEmails } from "./syncedEmails";

function email(overrides: Partial<SyncedEmail> & { id: string }): SyncedEmail {
  return {
    accountId: "acc",
    gmailMessageId: "same",
    threadId: "t",
    from: "sender@example.com",
    subject: "件名",
    snippet: "本文",
    receivedAt: 1_000,
    status: "unprocessed",
    createdAt: 1,
    ...overrides,
  };
}

function setupDb(emails: SyncedEmail[], drafts: { id: string; emailId: string }[] = []) {
  const tables = { syncedEmails: fakeTable(emails), draftReplies: fakeTable(drafts) };
  Object.assign(mocks.db, tables);
  return tables;
}

describe("mergeDuplicateEmails", () => {
  it("先に進んでいる行を残す(送信済み > 下書きあり > 未処理)", () => {
    const { keep, extras } = mergeDuplicateEmails([
      email({ id: "a", status: "unprocessed", createdAt: 1 }),
      email({ id: "b", status: "sent", createdAt: 2 }),
      email({ id: "c", status: "drafted", createdAt: 3 }),
    ]);
    expect(keep.id).toBe("b");
    expect(extras.map((e) => e.id).sort()).toEqual(["a", "c"]);
  });

  it("どれも未処理なら、先に取り込んだ行を残す", () => {
    const { keep } = mergeDuplicateEmails([
      email({ id: "later", createdAt: 200 }),
      email({ id: "earlier", createdAt: 100 }),
    ]);
    expect(keep.id).toBe("earlier");
  });

  it("消す行にだけ付いていた既読を、残す行へ引き継ぐ", () => {
    const { changes } = mergeDuplicateEmails([
      email({ id: "keep", status: "drafted", createdAt: 1 }),
      email({ id: "drop", createdAt: 2, readAt: 500, stateUpdatedAt: 900 }),
    ]);
    expect(changes).toEqual({ readAt: 500, stateUpdatedAt: 900 });
  });

  it("引き継ぐものが無ければ、残す行は書き換えない", () => {
    const { changes } = mergeDuplicateEmails([email({ id: "a", createdAt: 1 }), email({ id: "b", createdAt: 2 })]);
    expect(changes).toEqual({});
  });
});

describe("dedupeSyncedEmails", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.db)) delete mocks.db[key];
  });

  it("同じgmailMessageIdの行を1行に畳み、AI下書きは残す行へ付け替える", async () => {
    const tables = setupDb(
      [
        email({ id: "dup", gmailMessageId: "g-1", createdAt: 2 }),
        email({ id: "orig", gmailMessageId: "g-1", createdAt: 1, readAt: 700 }),
        email({ id: "other", gmailMessageId: "g-2", createdAt: 3 }),
      ],
      [{ id: "draft-1", emailId: "dup" }],
    );

    expect(await dedupeSyncedEmails("acc")).toBe(1);
    expect(tables.syncedEmails.rows.map((e) => e.id)).toEqual(["orig", "other"]);
    expect(tables.draftReplies.rows).toEqual([{ id: "draft-1", emailId: "orig" }]);
    expect(tables.syncedEmails.rows.find((e) => e.id === "orig")?.readAt).toBe(700);
  });

  it("残す行がすでに下書きを持っていたら、消す行の下書きは捨てる", async () => {
    const tables = setupDb(
      [
        email({ id: "keep", gmailMessageId: "g-1", status: "drafted", createdAt: 1 }),
        email({ id: "drop", gmailMessageId: "g-1", createdAt: 2 }),
      ],
      [
        { id: "draft-keep", emailId: "keep" },
        { id: "draft-drop", emailId: "drop" },
      ],
    );

    expect(await dedupeSyncedEmails("acc")).toBe(1);
    expect(tables.draftReplies.rows).toEqual([{ id: "draft-keep", emailId: "keep" }]);
  });

  it("重複が無ければ何も消さない", async () => {
    const tables = setupDb([email({ id: "a", gmailMessageId: "g-1" }), email({ id: "b", gmailMessageId: "g-2" })]);
    expect(await dedupeSyncedEmails("acc")).toBe(0);
    expect(tables.syncedEmails.rows).toHaveLength(2);
  });
});
