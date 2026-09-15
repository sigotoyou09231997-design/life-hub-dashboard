import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accounts: [] as { id: string; email: string }[],
  emails: [] as { id: string; accountId: string; gmailMessageId: string }[],
}));

vi.mock("../db/schema", () => ({
  db: {
    gmailAccounts: {
      where: () => ({
        equals: (email: string) => ({ first: async () => mocks.accounts.find((a) => a.email === email) }),
      }),
    },
    syncedEmails: {
      where: () => ({
        equals: ([accountId, messageId]: [string, string]) => ({
          first: async () => mocks.emails.find((e) => e.accountId === accountId && e.gmailMessageId === messageId),
        }),
      }),
    },
  },
}));

import { gmailWebUrl, resolveMailLinkTarget, toEventMailLinkRecord } from "./eventMailLink";

beforeEach(() => {
  mocks.accounts = [];
  mocks.emails = [];
});

describe("toEventMailLinkRecord", () => {
  it("端末ごとのidではなく、Gmail側のidとアドレスでメールを指す", () => {
    const record = toEventMailLinkRecord(
      "event-1",
      { email: "me@example.com" },
      { gmailMessageId: "18f0a", threadId: "18e00", subject: "面接のご案内", from: "山田 <yamada@example.com>" },
      1_000,
    );
    expect(record).toEqual({
      eventId: "event-1",
      accountEmail: "me@example.com",
      gmailMessageId: "18f0a",
      threadId: "18e00",
      subject: "面接のご案内",
      sender: "山田 <yamada@example.com>",
      createdAt: 1_000,
    });
  });

  it("空の件名・差出人は項目ごと持たない(同期で空文字を送らない)", () => {
    const record = toEventMailLinkRecord(
      "event-1",
      { email: "me@example.com" },
      { gmailMessageId: "18f0a", threadId: "", subject: "", from: "" },
      1_000,
    );
    expect(record.subject).toBeUndefined();
    expect(record.sender).toBeUndefined();
    expect(record.threadId).toBeUndefined();
  });
});

describe("gmailWebUrl", () => {
  it("受け取ったアカウントを選んだうえで、そのメールを開く", () => {
    expect(gmailWebUrl({ accountEmail: "me+work@example.com", gmailMessageId: "18f0a" })).toBe(
      "https://mail.google.com/mail/u/me%2Bwork%40example.com/#all/18f0a",
    );
  });
});

describe("resolveMailLinkTarget", () => {
  const link = { accountEmail: "me@example.com", gmailMessageId: "18f0a" };

  it("この端末にメールがあれば、アプリのメール画面を開く", async () => {
    mocks.accounts = [{ id: "acc-1", email: "me@example.com" }];
    mocks.emails = [{ id: "local-1", accountId: "acc-1", gmailMessageId: "18f0a" }];
    expect(await resolveMailLinkTarget(link)).toEqual({ kind: "app", to: "/gmail/mail/local-1" });
  });

  it("メールが端末から消えていても(受信トレイから外れた等)、Gmail本体で開ける", async () => {
    mocks.accounts = [{ id: "acc-1", email: "me@example.com" }];
    expect(await resolveMailLinkTarget(link)).toEqual({
      kind: "gmail",
      href: "https://mail.google.com/mail/u/me%40example.com/#all/18f0a",
    });
  });

  it("このアカウントを端末に連携していなくても、Gmail本体で開ける", async () => {
    expect((await resolveMailLinkTarget(link)).kind).toBe("gmail");
  });
});
