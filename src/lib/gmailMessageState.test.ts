import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncedEmail } from "../types";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSession: vi.fn(),
  syncedEmails: { where: vi.fn(), update: vi.fn() },
}));

vi.mock("./supabase", () => ({ isSupabaseConfigured: true, auth: { getSession: mocks.getSession } }));
vi.mock("./supabaseData", () => ({ getSupabaseDataClient: vi.fn(async () => ({ from: mocks.from })) }));
vi.mock("../db/schema", () => ({ db: { syncedEmails: mocks.syncedEmails } }));

import { pullMessageStates, pushPendingMessageStates, updateMessageState } from "./gmailMessageState";

/** Stands in for db.syncedEmails.where("accountId").equals(id).toArray(). */
function localEmails(rows: SyncedEmail[]) {
  mocks.syncedEmails.where.mockReturnValue({ equals: () => ({ toArray: async () => rows }) });
}

/** Stands in for supabase.from("gmail_message_state").select(...).eq(...).eq(...). */
function remoteStates(rows: { gmail_message_id: string; read_at: string | null; sent: boolean; updated_at: string }[]) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.upsert = vi.fn(async () => ({ error: null }));
  (query as { then?: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  mocks.from.mockReturnValue(query);
  return query;
}

function email(overrides: Partial<SyncedEmail> = {}): SyncedEmail {
  return {
    id: "local-1",
    accountId: "account-1",
    gmailMessageId: "msg-1",
    threadId: "thread-1",
    from: "sender@example.com",
    subject: "件名",
    snippet: "本文",
    receivedAt: 1_000,
    status: "unprocessed",
    createdAt: 1_000,
    ...overrides,
  };
}

describe("pullMessageStates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
  });

  it("他端末で既読にされたメールをこの端末でも既読にする", async () => {
    remoteStates([{ gmail_message_id: "msg-1", read_at: "2026-08-23T00:00:00.000Z", sent: false, updated_at: "2026-08-23T00:00:00.000Z" }]);
    localEmails([email()]);

    await pullMessageStates("account-1", "me@example.com");

    expect(mocks.syncedEmails.update).toHaveBeenCalledWith("local-1", {
      readAt: Date.parse("2026-08-23T00:00:00.000Z"),
      stateUpdatedAt: Date.parse("2026-08-23T00:00:00.000Z"),
    });
  });

  it("他端末で未読に戻されたら、この端末の既読も外す", async () => {
    remoteStates([{ gmail_message_id: "msg-1", read_at: null, sent: false, updated_at: "2026-08-23T09:00:00.000Z" }]);
    localEmails([email({ readAt: Date.parse("2026-08-23T00:00:00.000Z"), stateUpdatedAt: Date.parse("2026-08-23T00:00:00.000Z") })]);

    await pullMessageStates("account-1", "me@example.com");

    expect(mocks.syncedEmails.update).toHaveBeenCalledWith("local-1", {
      readAt: undefined,
      stateUpdatedAt: Date.parse("2026-08-23T09:00:00.000Z"),
    });
  });

  it("この端末の操作の方が新しければ、古いサーバー側の状態で上書きしない", async () => {
    remoteStates([{ gmail_message_id: "msg-1", read_at: "2026-08-23T00:00:00.000Z", sent: false, updated_at: "2026-08-23T00:00:00.000Z" }]);
    localEmails([email({ stateUpdatedAt: Date.parse("2026-08-23T10:00:00.000Z") })]);

    await pullMessageStates("account-1", "me@example.com");

    expect(mocks.syncedEmails.update).not.toHaveBeenCalled();
  });

  it("ローカルにまだ無いメールの状態は無視する(入れる場所が無いため)", async () => {
    remoteStates([{ gmail_message_id: "msg-unknown", read_at: null, sent: true, updated_at: "2026-08-23T00:00:00.000Z" }]);
    localEmails([email()]);

    await pullMessageStates("account-1", "me@example.com");

    expect(mocks.syncedEmails.update).not.toHaveBeenCalled();
  });

  it("送信済みは取り込むが、送信済みを取り消す方向には動かさない", async () => {
    remoteStates([{ gmail_message_id: "msg-1", read_at: null, sent: false, updated_at: "2026-08-23T09:00:00.000Z" }]);
    localEmails([email({ status: "sent" })]);

    await pullMessageStates("account-1", "me@example.com");

    const changes = mocks.syncedEmails.update.mock.calls[0][1] as Record<string, unknown>;
    expect(changes.status).toBeUndefined();
  });
});

describe("updateMessageState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
  });

  it("ローカルを更新し、同じ内容をサーバーにも送る", async () => {
    const query = remoteStates([]);
    await updateMessageState("me@example.com", email(), { readAt: 5_000 });

    const [id, changes] = mocks.syncedEmails.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe("local-1");
    expect(changes.readAt).toBe(5_000);
    expect(typeof changes.stateUpdatedAt).toBe("number");

    // push自体は fire-and-forget (ローカルの操作を待たせない)ので、送られるまで待つ。
    const upsert = query.upsert as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    const row = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ account_email: "me@example.com", gmail_message_id: "msg-1", sent: false });
    expect(row.read_at).toBe(new Date(5_000).toISOString());
  });
});

describe("pushPendingMessageStates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
  });

  it("この仕組みより前に既読にした分をまとめて送り、読んだ時刻をupdated_atにする", async () => {
    const query = remoteStates([]);
    localEmails([
      email({ id: "local-1", gmailMessageId: "msg-1", readAt: 5_000 }),
      email({ id: "local-2", gmailMessageId: "msg-2" }),
      email({ id: "local-3", gmailMessageId: "msg-3", status: "sent" }),
    ]);

    const result = await pushPendingMessageStates("account-1", "me@example.com");

    expect(result).toEqual({ count: 2, error: null });
    const rows = (query.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>[];
    expect(rows.map((r) => r.gmail_message_id)).toEqual(["msg-1", "msg-3"]);
    // 未読のmsg-2は送らない。msg-1のupdated_atは「今」ではなく実際に読んだ時刻。
    expect(rows[0].updated_at).toBe(new Date(5_000).toISOString());
    expect(mocks.syncedEmails.update).toHaveBeenCalledWith("local-1", { stateUpdatedAt: 5_000 });
  });

  it("一度送った分(stateUpdatedAtあり)は送り直さない", async () => {
    const query = remoteStates([]);
    localEmails([email({ readAt: 5_000, stateUpdatedAt: 5_000 })]);

    expect(await pushPendingMessageStates("account-1", "me@example.com")).toEqual({ count: 0, error: null });
    expect(query.upsert).not.toHaveBeenCalled();
  });

  it("失敗したらエラーを返し、送信済みとして印を付けない", async () => {
    const query = remoteStates([]);
    (query.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ error: { message: "relation does not exist" } });
    localEmails([email({ readAt: 5_000 })]);

    expect(await pushPendingMessageStates("account-1", "me@example.com")).toEqual({
      count: 0,
      error: "relation does not exist",
    });
    expect(mocks.syncedEmails.update).not.toHaveBeenCalled();
  });
});
