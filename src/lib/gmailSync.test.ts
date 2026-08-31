import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailAccount } from "../types";

/** 同期が触るテーブルだけを持つ最小の偽DB。中身は `mocks.rows` に入れ、消された行は
 * `mocks.deleted` に溜まる(既定はどのテーブルも空 = 空の受信トレイ)。 */
const mocks = vi.hoisted(() => {
  const rows: Record<string, Record<string, unknown>[]> = {};
  const deleted: Record<string, string[]> = {};
  const table = (name: string) => ({
    where: () => ({
      equals: () => ({
        toArray: async () => rows[name] ?? [],
        first: async () => (rows[name] ?? [])[0],
        count: async () => (rows[name] ?? []).length,
      }),
    }),
    update: vi.fn(async () => undefined),
    add: vi.fn(async () => "new-row"),
    bulkGet: async () => [],
    delete: vi.fn(async (id: string) => {
      (deleted[name] ??= []).push(id);
    }),
  });
  return {
    rows,
    deleted,
    db: {
      syncedEmails: table("syncedEmails"),
      draftReplies: table("draftReplies"),
      blockedSenders: table("blockedSenders"),
      gmailAccounts: table("gmailAccounts"),
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
import { describeSyncError, isReauthRequiredError, summarizeGmailSync, syncGmailAccount } from "./gmailSync";

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

describe("受信トレイから消えたメールの掃除", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  /** 掃除の対象になるのは「Gmailの受信トレイに無い」行なので、一覧は空のまま
   * (complete: true = 30日ぶんを最後まで数えきれた)にして走らせる。 */
  beforeEach(() => {
    for (const key of Object.keys(mocks.rows)) delete mocks.rows[key];
    for (const key of Object.keys(mocks.deleted)) delete mocks.deleted[key];
    mocks.listRecentMessageIds.mockResolvedValue({ ids: [], complete: true });
  });

  const localEmail = (id: string, receivedAt: number) => ({
    id,
    accountId: "account-a",
    gmailMessageId: `gmail-${id}`,
    threadId: `thread-${id}`,
    from: "someone@example.com",
    subject: "件名",
    snippet: "",
    receivedAt,
    status: "unprocessed" as const,
    createdAt: 0,
  });

  it("30日の範囲内でGmailの受信トレイから無くなったメールは、この端末からも消す", async () => {
    mocks.rows.syncedEmails = [localEmail("recent", Date.now() - 3 * DAY_MS)];

    const result = await syncGmailAccount(account("account-a", "me@example.com"));

    expect(mocks.deleted.syncedEmails).toEqual(["recent"]);
    expect(result.summary).toContain("1件をGmailに合わせて削除");
  });

  it("30日より前のメールは、範囲外なだけなので消さない", async () => {
    // 一覧は直近30日しか見ていない。日が経って範囲から外れただけの分まで
    // 「Gmailから無くなった」と見なすと、手元のメールが黙って減っていく。
    mocks.rows.syncedEmails = [localEmail("old", Date.now() - 45 * DAY_MS)];

    const result = await syncGmailAccount(account("account-a", "me@example.com"));

    expect(mocks.deleted.syncedEmails).toBeUndefined();
    expect(result.summary).toBe(NO_CHANGES_SUMMARY);
  });
});
