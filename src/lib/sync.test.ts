// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return {
    channel,
    from: vi.fn(),
    removeChannel: vi.fn(),
    syncQueue: { toArray: vi.fn(), count: vi.fn(), delete: vi.fn(), where: vi.fn(), add: vi.fn(), update: vi.fn() },
  };
});

vi.mock("./supabaseData", () => ({
  getSupabaseDataClient: vi.fn(async () => ({
    from: mocks.from,
    channel: vi.fn(() => mocks.channel),
    removeChannel: mocks.removeChannel,
    realtime: { setAuth: vi.fn() },
  })),
}));
vi.mock("../db/schema", () => ({ db: { syncQueue: mocks.syncQueue } }));
vi.mock("./deviceId", () => ({ getDeviceId: () => "device-1" }));

type HookCallback = (...args: unknown[]) => unknown;
function table() {
  const hooks = new Map<string, HookCallback>();
  return {
    hooks,
    hook: vi.fn((name: string, callback: HookCallback) => hooks.set(name, callback)),
    get: vi.fn(), add: vi.fn(), update: vi.fn(), delete: vi.fn(),
  };
}

describe("sync session lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.channel.on.mockReturnValue(mocks.channel);
    mocks.channel.subscribe.mockReturnValue(mocks.channel);
    mocks.syncQueue.toArray.mockResolvedValue([]);
    mocks.syncQueue.count.mockResolvedValue(0);
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    localStorage.clear();
  });

  it("starts PostgREST reconciliation and Realtime after login", async () => {
    const query = { select: vi.fn(), gte: vi.fn() };
    query.select.mockReturnValue(query);
    query.gte.mockResolvedValue({ data: [], error: null });
    mocks.from.mockReturnValue(query);
    const sync = await import("./sync");
    sync.registerSyncedTable(table() as never, "tasks");
    await sync.startSession("user-1", "token-1");
    await vi.waitFor(() => expect(mocks.channel.subscribe).toHaveBeenCalledOnce());
    expect(mocks.from).toHaveBeenCalledWith("tasks");
    expect(mocks.channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ table: "tasks", filter: "user_id=eq.user-1" }),
      expect.any(Function),
    );
    expect(mocks.channel.subscribe).toHaveBeenCalledOnce();
  });

  it("removes every Realtime subscription on logout", async () => {
    const query = { select: vi.fn(), gte: vi.fn() };
    query.select.mockReturnValue(query);
    query.gte.mockResolvedValue({ data: [], error: null });
    mocks.from.mockReturnValue(query);
    const sync = await import("./sync");
    sync.registerSyncedTable(table() as never, "tasks");
    await sync.startSession("user-1", "token-1");
    await vi.waitFor(() => expect(mocks.channel.subscribe).toHaveBeenCalledOnce());

    sync.stopSession();
    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channel);
  });

  it("reports a PostgREST failure from manual sync without losing the session", async () => {
    const query = { select: vi.fn(), gte: vi.fn() };
    query.select.mockReturnValue(query);
    query.gte.mockResolvedValue({ data: null, error: { message: "network failed" } });
    mocks.from.mockReturnValue(query);
    const sync = await import("./sync");
    sync.registerSyncedTable(table() as never, "tasks");
    await sync.startSession("user-1", "token-1");
    await vi.waitFor(() => expect(mocks.from).toHaveBeenCalled());

    const result = await sync.syncNow();
    expect(result).toContain("タスクを受け取れませんでした（network failed）");
  });

  it("keeps pushing other rows when the server rejects one row, and marks the rejected one", async () => {
    const upsert = vi.fn(async (row: Record<string, unknown>) =>
      row.id === "bad"
        ? { error: { code: "42703", message: "column calendar_events.repeat does not exist" } }
        : { error: null },
    );
    const query = { select: vi.fn(), gte: vi.fn(), upsert };
    query.select.mockReturnValue(query);
    query.gte.mockResolvedValue({ data: [], error: null });
    mocks.from.mockReturnValue(query);
    mocks.syncQueue.toArray.mockResolvedValue([
      { id: 1, table: "calendar_events", rowId: "bad", op: "upsert", queuedAt: 1 },
      { id: 2, table: "transactions", rowId: "good", op: "upsert", queuedAt: 2 },
    ]);
    const events = table();
    events.get.mockResolvedValue({ id: "bad", title: "x" });
    const money = table();
    money.get.mockResolvedValue({ id: "good", amount: 100 });
    const sync = await import("./sync");
    sync.registerSyncedTable(events as never, "calendar_events");
    sync.registerSyncedTable(money as never, "transactions");
    await sync.startSession("user-1", "token-1");

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(mocks.syncQueue.delete).toHaveBeenCalledWith(2);
    expect(mocks.syncQueue.delete).not.toHaveBeenCalledWith(1);
    expect(mocks.syncQueue.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ lastError: "42703: column calendar_events.repeat does not exist" }),
    );
  });

  it("stops at a network failure without blaming the row", async () => {
    const upsert = vi.fn(async () => ({ error: { code: "", message: "TypeError: Failed to fetch" } }));
    const query = { select: vi.fn(), gte: vi.fn(), upsert };
    query.select.mockReturnValue(query);
    query.gte.mockResolvedValue({ data: [], error: null });
    mocks.from.mockReturnValue(query);
    mocks.syncQueue.toArray.mockResolvedValue([
      { id: 1, table: "tasks", rowId: "a", op: "upsert", queuedAt: 1 },
      { id: 2, table: "tasks", rowId: "b", op: "upsert", queuedAt: 2 },
    ]);
    const tasks = table();
    tasks.get.mockResolvedValue({ id: "a" });
    const sync = await import("./sync");
    sync.registerSyncedTable(tasks as never, "tasks");
    await sync.startSession("user-1", "token-1");

    expect(upsert).toHaveBeenCalledOnce();
    expect(mocks.syncQueue.update).not.toHaveBeenCalled();
    expect(mocks.syncQueue.delete).not.toHaveBeenCalled();
  });
});

describe("describeSyncResult", () => {
  it("says it synced in one short line when nothing went wrong", async () => {
    const { describeSyncResult } = await import("./sync");
    const result = describeSyncResult(
      [
        { tableName: "transactions", rows: 85, outcomes: { updated: 79, deleted: 6 }, error: null },
        { tableName: "calendar_events", rows: 7, outcomes: { "skipped-echo": 7 }, error: null },
      ],
      2,
      [],
    );
    expect(result).toBe("同期しました（受け取り85件・送信2件）");
  });

  it("says there was nothing to do when nothing changed", async () => {
    const { describeSyncResult } = await import("./sync");
    expect(describeSyncResult([{ tableName: "tasks", rows: 1, outcomes: { "skipped-echo": 1 }, error: null }], 0, [])).toBe(
      "同期しました（変更はありませんでした）",
    );
  });

  it("names the table and the likely cause when rows are stuck", async () => {
    const { describeSyncResult } = await import("./sync");
    const result = describeSyncResult([], 3, [
      { id: 1, table: "calendar_events", rowId: "a", op: "upsert", queuedAt: 1, lastError: "42703: column x does not exist" },
      { id: 2, table: "calendar_events", rowId: "b", op: "upsert", queuedAt: 1, lastError: "42703: column x does not exist" },
      { id: 3, table: "tasks", rowId: "c", op: "upsert", queuedAt: 1 },
    ]);
    expect(result).toContain("予定の変更2件を送れませんでした：本番のデータベースに列が足りません");
    expect(result).toContain("まだ送れていない変更が1件あります");
    expect(result).not.toContain("同期しました");
  });
});
