// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * アプリに戻った時の同期(syncOnResume)と、つながりが戻った時の取りこぼしの取り直し(2026-11-21)。
 * 戻るたびに全部の表を全件取り直していた頃は、戻った直後が重く、新しい変更が見えるのも遅かった。
 */
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

const noMemberships = vi.fn(() => ({ eq: vi.fn(async () => ({ data: [], error: null })) }));

type HookCallback = (...args: unknown[]) => unknown;
function table() {
  const hooks = new Map<string, HookCallback>();
  return {
    hooks,
    hook: vi.fn((name: string, callback: HookCallback) => hooks.set(name, callback)),
    get: vi.fn(), add: vi.fn(), update: vi.fn(), delete: vi.fn(),
  };
}

function okQuery() {
  const query = { select: vi.fn(), gte: vi.fn(), eq: noMemberships };
  query.select.mockReturnValue(query);
  query.gte.mockResolvedValue({ data: [], error: null });
  mocks.from.mockReturnValue(query);
  return query;
}

/** 起動して、最初の取り込み(カーソルを書く)が済んだ状態にする。 */
async function started() {
  const query = okQuery();
  const sync = await import("./sync");
  sync.registerSyncedTable(table() as never, "tasks");
  await sync.startSession("user-1", "token-1");
  await vi.waitFor(() => expect(mocks.channel.subscribe).toHaveBeenCalledTimes(2));
  return { sync, query };
}

/** 取り込み時に渡された since(gte の2つ目の引数)を、tasks 表のものだけ新しい順に。 */
function sinces(query: { gte: ReturnType<typeof vi.fn> }): string[] {
  return query.gte.mock.calls.map((call) => call[1] as string);
}

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

describe("アプリに戻った時の同期(syncOnResume)", () => {
  it("全件の取り直しをした直後なら、前回の時刻の少し前からの差分だけを取る", async () => {
    const { sync, query } = await started();
    const cursor = localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("lifeHubLastSynced:tasks"))!)!;
    // 全件の取り直しの印をつけて(いま全件を済ませた扱い)、差分で戻る。
    const key = Object.keys(localStorage).find((k) => k.includes("lifeHubLastSynced:tasks"))!.replace("lifeHubLastSynced:tasks", "lifeHubLastFullPull");
    localStorage.setItem(key, String(Date.now()));
    query.gte.mockClear();

    await sync.syncOnResume(Date.now() + 10_000);

    const [since] = sinces(query);
    expect(since).not.toBe(new Date(0).toISOString());
    // カーソルより2分前(重ねて取る幅)から取る。
    expect(Date.parse(since)).toBe(Date.parse(cursor) - sync.RESUME_OVERLAP_MS);
  });

  it("24時間以上全件を取っていなければ、全件で取り直して、済んだ印を付ける", async () => {
    const { sync, query } = await started();
    query.gte.mockClear();

    await sync.syncOnResume(Date.now() + 10_000);

    expect(sinces(query)).toEqual([new Date(0).toISOString()]);
    const stamp = Object.keys(localStorage).find((k) => k.includes("lifeHubLastFullPull"));
    expect(stamp).toBeTruthy();
  });

  it("全件を取り直した表に失敗があれば、済んだ印を付けない(次の機会にまた全件で取る)", async () => {
    const { sync, query } = await started();
    query.gte.mockResolvedValue({ data: null, error: { message: "network failed" } });

    await sync.syncOnResume(Date.now() + 10_000);

    expect(Object.keys(localStorage).some((k) => k.includes("lifeHubLastFullPull"))).toBe(false);
  });

  it("3秒以内に続けて戻っても、通信は1回だけ", async () => {
    const { sync, query } = await started();
    query.gte.mockClear();
    const now = Date.now() + 10_000;

    await sync.syncOnResume(now);
    const afterFirst = query.gte.mock.calls.length;
    await sync.syncOnResume(now + 1000);

    expect(query.gte.mock.calls.length).toBe(afterFirst);
  });

  it("「今すぐ同期」は毎回全件で、成功したら全件の済んだ印を付ける", async () => {
    const { sync, query } = await started();
    query.gte.mockClear();

    await sync.syncNow();

    expect(sinces(query)).toEqual([new Date(0).toISOString()]);
    expect(Object.keys(localStorage).some((k) => k.includes("lifeHubLastFullPull"))).toBe(true);
  });

  it("ログインしていなければ何もしない", async () => {
    okQuery();
    const sync = await import("./sync");
    await sync.syncOnResume();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe("リアルタイムのつながりが戻った時", () => {
  it("最初の「つながった」では取り直さず、2回目以降(切れて戻った時)は差分を取り直す", async () => {
    const { query } = await started();
    // tasks 表の購読に渡された、状態の通知の関数。
    const statusCallback = mocks.channel.subscribe.mock.calls
      .map((call) => call[0] as ((status: string) => void) | undefined)
      .find((fn) => typeof fn === "function")!;
    expect(statusCallback).toBeTruthy();
    query.gte.mockClear();

    statusCallback("SUBSCRIBED"); // 最初のつながり: 起動の取り込みで足りている
    await Promise.resolve();
    expect(query.gte).not.toHaveBeenCalled();

    statusCallback("CLOSED");
    statusCallback("SUBSCRIBED"); // 切れて戻った: 取りこぼしを埋める
    await vi.waitFor(() => expect(query.gte).toHaveBeenCalledTimes(1));
  });
});
