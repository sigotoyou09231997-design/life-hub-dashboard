import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailAccount } from "../types";

/** 同期が触るテーブルのうち、このテストが通る経路(空の受信トレイ)だけを持つ最小の偽DB。 */
const mocks = vi.hoisted(() => {
  const emptyQuery = { toArray: async () => [], first: async () => undefined, count: async () => 0 };
  const emptyTable = {
    where: () => ({ equals: () => emptyQuery }),
    update: vi.fn(async () => undefined),
    bulkGet: async () => [],
  };
  return {
    db: {
      syncedEmails: emptyTable,
      draftReplies: emptyTable,
      blockedSenders: emptyTable,
      gmailAccounts: emptyTable,
      settings: { toCollection: () => ({ first: async () => undefined }) },
    },
    ensureFreshAccessToken: vi.fn(async (account: GmailAccount) => account),
    listRecentMessageIds: vi.fn(async () => ({ ids: [] as string[], complete: true })),
    pushPendingMessageStates: vi.fn(async () => ({ count: 0, error: null as string | null })),
    pullMessageStates: vi.fn(async () => ({ count: 0, error: null as string | null })),
  };
});

vi.mock("../db/schema", () => ({ db: mocks.db }));
// 文面の組み立て(buildSyncSummary / NO_CHANGES_SUMMARY)は本物のまま使い、
// 通信するものだけ差し替える。
vi.mock("./gmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gmail")>()),
  ensureFreshAccessToken: mocks.ensureFreshAccessToken,
  listRecentMessageIds: mocks.listRecentMessageIds,
  generateDraftForEmail: vi.fn(),
  getMessageMeta: vi.fn(),
  threadHasSentReplyAfter: vi.fn(),
}));
vi.mock("./gmailMessageState", () => ({
  pushPendingMessageStates: mocks.pushPendingMessageStates,
  pullMessageStates: mocks.pullMessageStates,
}));
vi.mock("./syncedEmails", () => ({
  addEmailIfAbsent: vi.fn(async () => null),
  dedupeSyncedEmails: vi.fn(async () => undefined),
}));

import { NO_CHANGES_SUMMARY } from "./gmail";
import { autoSyncModeOnOpen, decideOpenSyncMode, describeSyncError, isReauthRequiredError, summarizeGmailSync, syncGmailAccount } from "./gmailSync";

const account = (id: string, email: string): GmailAccount => ({
  id,
  email,
  accessToken: "token",
  accessTokenExpiresAt: Date.now() + 60_000,
  refreshToken: "refresh",
  connectedAt: 0,
});

const ok = (summary: string, stateError: string | null = null) => ({ summary, stateError, error: null });

describe("summarizeGmailSync", () => {
  it("アカウントが1つなら、アドレスを頭に付けず今までと同じ文面のまま出す", () => {
    expect(summarizeGmailSync([{ email: "me@example.com", result: ok("2件の新着メールしました") }])).toEqual({
      message: "2件の新着メールしました",
      tone: "success",
    });
  });

  it("アカウントが複数なら、どのアカウントの話か分かるよう@より前を頭に付ける", () => {
    expect(
      summarizeGmailSync([
        { email: "work@example.com", result: ok("2件の新着メールしました") },
        { email: "private@example.net", result: ok("1件を送信済みに更新しました") },
      ]),
    ).toEqual({
      message: "work: 2件の新着メールしました / private: 1件を送信済みに更新しました",
      tone: "success",
    });
  });

  it("動きが無かったアカウントは行に出さない", () => {
    const summary = summarizeGmailSync([
      { email: "work@example.com", result: ok(NO_CHANGES_SUMMARY) },
      { email: "private@example.net", result: ok("3件の新着メールしました") },
    ]);
    expect(summary?.message).toBe("private: 3件の新着メールしました");
  });

  it("どのアカウントにも動きが無ければ、まとめて1行にする", () => {
    // アカウントの数だけ「新着メールはありませんでした」が並んでも読みにくいだけ。
    expect(
      summarizeGmailSync([
        { email: "work@example.com", result: ok(NO_CHANGES_SUMMARY) },
        { email: "private@example.net", result: ok(NO_CHANGES_SUMMARY) },
      ]),
    ).toEqual({ message: NO_CHANGES_SUMMARY, tone: "success" });
  });

  it("片方が失敗しても、もう片方の結果を巻き添えで消さない", () => {
    expect(
      summarizeGmailSync([
        { email: "work@example.com", result: { summary: "", stateError: null, error: "Gmailの連携が切れています" } },
        { email: "private@example.net", result: ok("1件の新着メールしました") },
      ]),
    ).toEqual({
      message: "work: Gmailの連携が切れています / private: 1件の新着メールしました",
      tone: "error",
    });
  });

  it("既読の共有だけ失敗した時も、そのことが必ず画面に出る", () => {
    // 以前は成功トーストが直後に上書きしていて、この失敗が一度も見えていなかった。
    expect(
      summarizeGmailSync([{ email: "me@example.com", result: ok("2件の新着メールしました", "権限がありません") }]),
    ).toEqual({ message: "既読の同期に失敗しました: 権限がありません", tone: "error" });
  });

  it("同期したアカウントが無ければ何も出さない", () => {
    expect(summarizeGmailSync([])).toBeNull();
  });
});

describe("describeSyncError", () => {
  it("利用量超過は、連携切れではなく「待てば直る」案内にする", () => {
    expect(describeSyncError(new Error("403 RATE_LIMIT_EXCEEDED"))).toContain("1分ほど待ってから");
  });

  it("連携切れは、つなぎ直す場所まで伝える", () => {
    expect(describeSyncError(new Error("invalid_grant"))).toContain("つなぎ直す");
  });
});

describe("isReauthRequiredError", () => {
  it("更新用トークンの失効は、つなぎ直すまで直らない失敗として扱う", () => {
    expect(isReauthRequiredError(new Error("invalid_grant"))).toBe(true);
    expect(isReauthRequiredError(new Error("Token has been expired or revoked."))).toBe(true);
  });

  it("利用量超過は、待てば直るので連携切れ扱いにしない", () => {
    // 同じ403で返ってくるが、ここで連携切れ扱いにすると自動同期を止めてしまう。
    expect(isReauthRequiredError(new Error("403 RATE_LIMIT_EXCEEDED"))).toBe(false);
  });

  it("それ以外の失敗は連携切れ扱いにしない", () => {
    expect(isReauthRequiredError(new Error("Failed to fetch"))).toBe(false);
  });
});

describe("syncGmailAccount", () => {
  beforeEach(() => {
    mocks.ensureFreshAccessToken.mockClear();
  });

  it("同じアカウントの同期が重なったら、2本目は1本目に相乗りする", async () => {
    // 一覧を開いた時の自動同期と、ヘッダーの「今すぐ同期」が同時に走る状況。
    const target = account("account-a", "me@example.com");
    const [first, second] = await Promise.all([syncGmailAccount(target), syncGmailAccount(target)]);
    expect(mocks.ensureFreshAccessToken).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("同期し終わっていれば、次の呼び出しは新しく走る", async () => {
    const target = account("account-a", "me@example.com");
    await syncGmailAccount(target);
    await syncGmailAccount(target);
    expect(mocks.ensureFreshAccessToken).toHaveBeenCalledTimes(2);
  });

  it("別のアカウントどうしは互いに待たされない", async () => {
    await Promise.all([
      syncGmailAccount(account("account-a", "a@example.com")),
      syncGmailAccount(account("account-b", "b@example.com")),
    ]);
    expect(mocks.ensureFreshAccessToken).toHaveBeenCalledTimes(2);
  });
});

describe("画面を開いた時の自動同期の決め方(decideOpenSyncMode)", () => {
  const NOW = 1_000_000_000_000;
  const min = (n: number) => n * 60_000;

  it("一度も全部の同期をしていなければ、全部の同期", () => {
    expect(decideOpenSyncMode(undefined, undefined, NOW)).toBe("full");
  });

  it("全部の同期から10分以上たっていれば、全部の同期(確認だけしていても)", () => {
    expect(decideOpenSyncMode(NOW - min(10), NOW - 1_000, NOW)).toBe("full");
    expect(decideOpenSyncMode(NOW - min(30), undefined, NOW)).toBe("full");
  });

  it("全部の同期から10分以内で、直前(1分以内)に同期か確認をしていなければ、軽い確認", () => {
    expect(decideOpenSyncMode(NOW - min(5), undefined, NOW)).toBe("quick");
    expect(decideOpenSyncMode(NOW - min(5), NOW - min(2), NOW)).toBe("quick");
  });

  it("直前(1分以内)に同期か確認をしていれば、何もしない(メールを開いて戻るたびに走らせない)", () => {
    expect(decideOpenSyncMode(NOW - 5_000, undefined, NOW)).toBeNull();
    expect(decideOpenSyncMode(NOW - min(5), NOW - 30_000, NOW)).toBeNull();
  });

  it("アカウントごとに、この起動での確認を覚える(別のアカウントは別)", async () => {
    const a = account("open-a", "a@example.com");
    const recent = { ...a, lastSyncedAt: Date.now() - min(5) };
    expect(autoSyncModeOnOpen(recent)).toBe("quick");
    await syncGmailAccount(recent, "quick");
    expect(autoSyncModeOnOpen(recent)).toBeNull();
    expect(autoSyncModeOnOpen({ ...account("open-b", "b@example.com"), lastSyncedAt: Date.now() - min(5) })).toBe("quick");
  });
});

describe("軽い確認(quick)", () => {
  beforeEach(() => {
    mocks.ensureFreshAccessToken.mockClear();
    mocks.listRecentMessageIds.mockClear();
    mocks.pushPendingMessageStates.mockClear();
    mocks.pullMessageStates.mockClear();
    mocks.db.gmailAccounts.update.mockClear();
  });

  it("新着の確認(一覧の取得)だけで、既読の共有(Supabase)はしない。lastSyncedAt も進めない", async () => {
    await syncGmailAccount(account("q1", "q@example.com"), "quick");
    expect(mocks.listRecentMessageIds).toHaveBeenCalledTimes(1);
    expect(mocks.pushPendingMessageStates).not.toHaveBeenCalled();
    expect(mocks.pullMessageStates).not.toHaveBeenCalled();
    expect(mocks.db.gmailAccounts.update).not.toHaveBeenCalled();
  });

  it("全部の同期は、これまでどおり既読の共有もして、lastSyncedAt を進める", async () => {
    await syncGmailAccount(account("f1", "f@example.com"));
    expect(mocks.pushPendingMessageStates).toHaveBeenCalledTimes(1);
    expect(mocks.pullMessageStates).toHaveBeenCalledTimes(1);
    expect(mocks.db.gmailAccounts.update).toHaveBeenCalledWith("f1", expect.objectContaining({ lastSyncedAt: expect.any(Number) }));
  });

  it("軽い確認が走っている最中に全部の同期が来たら、確認が終わってから全部をやる(確認の結果で済ませない)", async () => {
    const target = account("q2", "q@example.com");
    const quick = syncGmailAccount(target, "quick");
    const full = syncGmailAccount(target, "full");
    expect(full).not.toBe(quick);
    await Promise.all([quick, full]);
    expect(mocks.listRecentMessageIds).toHaveBeenCalledTimes(2);
    expect(mocks.pullMessageStates).toHaveBeenCalledTimes(1);
  });

  it("全部の同期が走っている最中に軽い確認が来たら、相乗りする", async () => {
    const target = account("q3", "q@example.com");
    const full = syncGmailAccount(target, "full");
    const quick = syncGmailAccount(target, "quick");
    expect(quick).toBe(full);
    await full;
    expect(mocks.listRecentMessageIds).toHaveBeenCalledTimes(1);
  });
});

describe("summarizeGmailSync の quiet(自動の同期)", () => {
  it("何も無かった時は、お知らせしない。「今すぐ同期」(quiet なし)は今までどおり出す", () => {
    const none = [{ email: "me@example.com", result: ok(NO_CHANGES_SUMMARY) }];
    expect(summarizeGmailSync(none, { quiet: true })).toBeNull();
    expect(summarizeGmailSync(none)).toEqual({ message: NO_CHANGES_SUMMARY, tone: "success" });
  });

  it("新着があった時・失敗した時は、自動でもお知らせする", () => {
    expect(summarizeGmailSync([{ email: "me@example.com", result: ok("3件の新着メールを取り込みました") }], { quiet: true })?.message).toContain("3件");
    expect(summarizeGmailSync([{ email: "me@example.com", result: { summary: "", stateError: null, error: "失敗" } }], { quiet: true })).toEqual({ message: "失敗", tone: "error" });
  });
});
