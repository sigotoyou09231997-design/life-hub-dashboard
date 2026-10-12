/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockedSender, GmailAccount, SyncedEmail } from "../types";

// 1つ目のテストは、動的 import で重い部品(判定の処理など)を読み込む。Mac が混み合っている時(別の作業やほかの反映と同時の時)は、
// 既定の5秒を超えて時間切れになることがあった(2026-10-13)。内容は変えず、上限だけ30秒に伸ばす。
vi.setConfig({ testTimeout: 30_000 });

const mocks = vi.hoisted(() => ({
  accounts: [] as GmailAccount[],
  emails: [] as SyncedEmail[],
  blocked: [] as BlockedSender[],
  emailQueries: 0,
}));

vi.mock("../db/schema", () => ({
  db: {
    gmailAccounts: { toArray: async () => mocks.accounts },
    syncedEmails: {
      where: () => ({
        equals: () => ({
          reverse: () => ({
            sortBy: async () => {
              mocks.emailQueries += 1;
              return mocks.emails;
            },
          }),
        }),
      }),
    },
    blockedSenders: { where: () => ({ equals: () => ({ toArray: async () => mocks.blocked }) }) },
  },
}));

function account(id: string): GmailAccount {
  return { id, email: `${id}@example.com`, accessToken: "a", accessTokenExpiresAt: 0, refreshToken: "r", connectedAt: 0 };
}

function mail(id: string, accountId: string, from = "採用担当 <hr@example.com>"): SyncedEmail {
  return {
    id,
    accountId,
    gmailMessageId: `g-${id}`,
    threadId: `t-${id}`,
    from,
    subject: "お知らせ",
    snippet: "",
    receivedAt: 1,
    status: "unprocessed",
    createdAt: 0,
  };
}

async function load() {
  vi.resetModules();
  const warmup = await import("./gmailWarmup");
  const cache = await import("./gmailViewCache");
  return { warmGmail: warmup.warmGmail, cache: cache.gmailViewCache, visibleMailsFor: cache.visibleMailsFor };
}

beforeEach(() => {
  localStorage.clear();
  mocks.accounts = [];
  mocks.emails = [];
  mocks.blocked = [];
  mocks.emailQueries = 0;
});

describe("起動後の Gmail の先読み", () => {
  it("連携していなければ何も読まない", async () => {
    const { warmGmail, cache } = await load();
    await warmGmail();
    expect(cache.accounts).toBeUndefined();
    expect(cache.list).toBeNull();
    expect(mocks.emailQueries).toBe(0);
  });

  it("選んでいたアカウントの一覧とブロック一覧を、控えに入れる", async () => {
    mocks.accounts = [account("acc1"), account("acc2")];
    mocks.emails = [mail("m1", "acc2"), mail("m2", "acc2")];
    mocks.blocked = [{ id: "b1", accountId: "acc2", email: "spam@example.com", createdAt: 0 } as unknown as BlockedSender];
    // gmailAccounts.ts は選んだアカウントを scopedKey 経由で localStorage に覚えている。ここでは未選択なので1件目。
    const { warmGmail, cache } = await load();
    await warmGmail();
    expect(cache.accounts).toHaveLength(2);
    expect(cache.list?.accountId).toBe("acc1");
    expect(cache.list?.emails).toHaveLength(2);
    expect(cache.list?.blocked).toHaveLength(1);
  });

  it("1回の起動で1度だけ読む", async () => {
    mocks.accounts = [account("acc1")];
    const { warmGmail } = await load();
    await warmGmail();
    await warmGmail();
    expect(mocks.emailQueries).toBe(1);
  });

  it("ブロックした送信者のメールは、見せる一覧から外す", async () => {
    const { visibleMailsFor } = await load();
    const emails = [mail("m1", "a", "Spam <spam@example.com>"), mail("m2", "a")];
    const blocked = [{ id: "b", accountId: "a", email: "spam@example.com" } as unknown as BlockedSender];
    expect(visibleMailsFor(emails, blocked).map((e) => e.id)).toEqual(["m2"]);
  });
});
