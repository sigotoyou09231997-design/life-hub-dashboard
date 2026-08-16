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
    expect(result).toContain("tasks: エラー(network failed)");
  });
});
