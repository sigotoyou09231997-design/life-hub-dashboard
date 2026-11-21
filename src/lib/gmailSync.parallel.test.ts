import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailAccount } from "../types";

/**
 * 「今すぐ同期」の速さ(2026-11-21、本人「Gmail の右上の同期ボタンを押したら更新が長い」)。
 * 実測で約80秒かかっていた。新しいメールの情報を1通ずつ順番に待っていたのが大半(120通で約55秒)。
 * 並べて取りに行くこと、並べすぎないこと(Gmail の上限)、AI の自動下書きは並べないこと、を確かめる。
 */
const mocks = vi.hoisted(() => {
  const state = {
    settings: { autoDraftEnabled: false } as { autoDraftEnabled: boolean },
    added: [] as string[],
    metaInFlight: 0,
    metaMaxInFlight: 0,
    draftInFlight: 0,
    draftMaxInFlight: 0,
    draftedAfterImport: true,
  };
  const emptyQuery = { toArray: async () => [], first: async () => undefined, count: async () => 0 };
  const emptyTable = { where: () => ({ equals: () => emptyQuery }), update: vi.fn(async () => undefined), bulkGet: async () => [] };
  return { state, emptyTable };
});

vi.mock("../db/schema", () => ({
  db: {
    syncedEmails: mocks.emptyTable,
    draftReplies: mocks.emptyTable,
    blockedSenders: mocks.emptyTable,
    gmailAccounts: mocks.emptyTable,
    settings: { toCollection: () => ({ first: async () => mocks.state.settings }) },
  },
}));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

vi.mock("./gmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gmail")>()),
  ensureFreshAccessToken: async (account: GmailAccount) => account,
  listRecentMessageIds: async () => ({ ids: Array.from({ length: 24 }, (_, i) => `m${i}`), complete: false }),
  getMessageMeta: async (_token: string, id: string) => {
    mocks.state.metaInFlight++;
    mocks.state.metaMaxInFlight = Math.max(mocks.state.metaMaxInFlight, mocks.state.metaInFlight);
    await wait(15);
    mocks.state.metaInFlight--;
    return { threadId: `t-${id}`, from: "a@example.com", subject: `件名 ${id}`, snippet: "", receivedAt: Date.now() };
  },
  generateDraftForEmail: async () => {
    // 取り込みが全部済む前に下書きを作り始めていたら印を落とす。
    if (mocks.state.added.length < 24) mocks.state.draftedAfterImport = false;
    mocks.state.draftInFlight++;
    mocks.state.draftMaxInFlight = Math.max(mocks.state.draftMaxInFlight, mocks.state.draftInFlight);
    await wait(5);
    mocks.state.draftInFlight--;
    return { keyPoints: [], candidateDates: [] };
  },
  threadHasSentReplyAfter: async () => false,
}));
vi.mock("./gmailMessageState", () => ({
  pushPendingMessageStates: async () => ({ count: 0, error: null }),
  pullMessageStates: async () => ({ count: 0, error: null }),
}));
vi.mock("./syncedEmails", () => ({
  addEmailIfAbsent: async (email: { gmailMessageId: string }) => {
    mocks.state.added.push(email.gmailMessageId);
    return `row-${email.gmailMessageId}`;
  },
  dedupeSyncedEmails: async () => undefined,
}));
vi.mock("./mailAutoEvent", () => ({ autoAddConfirmedEvents: async () => [] }));

import { syncGmailAccount } from "./gmailSync";

const account: GmailAccount = {
  id: "acc-1",
  email: "me@example.com",
  accessToken: "token",
  accessTokenExpiresAt: Date.now() + 3_600_000,
  refreshToken: "refresh",
  connectedAt: 0,
};

beforeEach(() => {
  Object.assign(mocks.state, {
    settings: { autoDraftEnabled: false },
    added: [],
    metaInFlight: 0,
    metaMaxInFlight: 0,
    draftInFlight: 0,
    draftMaxInFlight: 0,
    draftedAfterImport: true,
  });
});

describe("今すぐ同期: 新しいメールの取り込み", () => {
  it("1通ずつ待たずに並べて取りに行く。ただし同時に6本まで", async () => {
    const result = await syncGmailAccount(account, "full");
    expect(result.error).toBeNull();
    expect(mocks.state.added).toHaveLength(24);
    expect(mocks.state.metaMaxInFlight).toBeGreaterThan(1);
    expect(mocks.state.metaMaxInFlight).toBeLessThanOrEqual(6);
  });

  it("自動下書きは、取り込みが全部済んでから1通ずつ(AI を同時に何本も呼ばない)", async () => {
    mocks.state.settings = { autoDraftEnabled: true };
    await syncGmailAccount({ ...account, id: "acc-2" }, "full");
    expect(mocks.state.draftedAfterImport).toBe(true);
    expect(mocks.state.draftMaxInFlight).toBe(1);
  });
});
