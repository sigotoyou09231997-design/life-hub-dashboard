import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockedSender } from "../types";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSession: vi.fn(),
  blockedSenders: {
    where: vi.fn(),
    bulkAdd: vi.fn(),
    bulkDelete: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("./supabase", () => ({ isSupabaseConfigured: true, auth: { getSession: mocks.getSession } }));
vi.mock("./supabaseData", () => ({ getSupabaseDataClient: vi.fn(async () => ({ from: mocks.from })) }));
vi.mock("../db/schema", () => ({ db: { blockedSenders: mocks.blockedSenders } }));

/** Stands in for db.blockedSenders.where("accountId").equals(id).toArray(). */
function localRows(rows: BlockedSender[]) {
  mocks.blockedSenders.where.mockReturnValue({ equals: () => ({ toArray: async () => rows }) });
}

/** Stands in for supabase.from("blocked_senders").select(...).eq(...).eq(...). */
function remoteRows(senderEmails: string[]) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  const result = { data: senderEmails.map((sender_email) => ({ sender_email })), error: null };
  // The second .eq() is the awaited one; make every link in the chain thenable.
  (query as { then?: unknown }).then = (resolve: (v: unknown) => void) => resolve(result);
  mocks.from.mockReturnValue(query);
  return query;
}

describe("pullBlockedSenders", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
  });

  it("adds a sender blocked on another device to this device's list", async () => {
    remoteRows(["spam@example.com"]);
    localRows([]);
    const { pullBlockedSenders } = await import("./blockedSenders");

    await pullBlockedSenders("account-local-uuid", "me@gmail.com");

    expect(mocks.blockedSenders.bulkAdd).toHaveBeenCalledWith([
      expect.objectContaining({ accountId: "account-local-uuid", email: "spam@example.com" }),
    ]);
    expect(mocks.blockedSenders.bulkDelete).not.toHaveBeenCalled();
  });

  it("removes a local block that another device unblocked", async () => {
    remoteRows([]);
    localRows([{ id: "row-1", accountId: "acct", email: "spam@example.com", createdAt: 1, pushedAt: 2 }]);
    const { pullBlockedSenders } = await import("./blockedSenders");

    await pullBlockedSenders("acct", "me@gmail.com");

    expect(mocks.blockedSenders.bulkDelete).toHaveBeenCalledWith(["row-1"]);
  });

  it("keeps a local block whose push never reached the server", async () => {
    remoteRows([]);
    localRows([{ id: "row-1", accountId: "acct", email: "spam@example.com", createdAt: 1 }]);
    const { pullBlockedSenders } = await import("./blockedSenders");

    await pullBlockedSenders("acct", "me@gmail.com");

    expect(mocks.blockedSenders.bulkDelete).not.toHaveBeenCalled();
    expect(mocks.blockedSenders.bulkAdd).not.toHaveBeenCalled();
  });

  it("backfills pushedAt on pre-existing rows the server already has", async () => {
    remoteRows(["spam@example.com"]);
    localRows([{ id: "row-1", accountId: "acct", email: "spam@example.com", createdAt: 1 }]);
    const { pullBlockedSenders } = await import("./blockedSenders");

    await pullBlockedSenders("acct", "me@gmail.com");

    expect(mocks.blockedSenders.update).toHaveBeenCalledWith("row-1", { pushedAt: expect.any(Number) });
    expect(mocks.blockedSenders.bulkAdd).not.toHaveBeenCalled();
    expect(mocks.blockedSenders.bulkDelete).not.toHaveBeenCalled();
  });

  it("does nothing without a Supabase session", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    const { pullBlockedSenders } = await import("./blockedSenders");

    await pullBlockedSenders("acct", "me@gmail.com");

    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("runs one shared pull when called twice for the same account", async () => {
    remoteRows(["spam@example.com"]);
    localRows([]);
    const { pullBlockedSenders } = await import("./blockedSenders");

    await Promise.all([pullBlockedSenders("acct", "me@gmail.com"), pullBlockedSenders("acct", "me@gmail.com")]);

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.blockedSenders.bulkAdd).toHaveBeenCalledTimes(1);
  });
});

describe("pullBlockedSendersIfDue(画面を開くたびに取りに行かない)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    remoteRows([]);
    localRows([]);
  });

  it("前の取り込みから5分以内なら、取りに行かない。5分たてばまた取りに行く", async () => {
    const { pullBlockedSendersIfDue, BLOCKED_PULL_INTERVAL_MS } = await import("./blockedSenders");
    const t0 = 1_000_000;
    await pullBlockedSendersIfDue("acct", "me@gmail.com", t0);
    await pullBlockedSendersIfDue("acct", "me@gmail.com", t0 + 60_000);
    await pullBlockedSendersIfDue("acct", "me@gmail.com", t0 + BLOCKED_PULL_INTERVAL_MS - 1);
    expect(mocks.from).toHaveBeenCalledTimes(1);
    await pullBlockedSendersIfDue("acct", "me@gmail.com", t0 + BLOCKED_PULL_INTERVAL_MS);
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it("アカウントごとに数える(別のアカウントは、すぐ取りに行く)", async () => {
    const { pullBlockedSendersIfDue } = await import("./blockedSenders");
    await pullBlockedSendersIfDue("a", "a@gmail.com", 1);
    await pullBlockedSendersIfDue("b", "b@gmail.com", 2);
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });
});

describe("blockSenderRemote", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
  });

  it("stamps pushedAt once the block reaches Supabase", async () => {
    mocks.from.mockReturnValue({ upsert: vi.fn(async () => ({ error: null })) });
    const { blockSenderRemote } = await import("./blockedSenders");

    await blockSenderRemote("me@gmail.com", "spam@example.com", "row-1");

    expect(mocks.blockedSenders.update).toHaveBeenCalledWith("row-1", { pushedAt: expect.any(Number) });
  });

  it("leaves pushedAt unset when the push fails, so the pull won't delete the row", async () => {
    mocks.from.mockReturnValue({ upsert: vi.fn(async () => ({ error: { message: "offline" } })) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { blockSenderRemote } = await import("./blockedSenders");

    await blockSenderRemote("me@gmail.com", "spam@example.com", "row-1");

    expect(mocks.blockedSenders.update).not.toHaveBeenCalled();
  });
});
