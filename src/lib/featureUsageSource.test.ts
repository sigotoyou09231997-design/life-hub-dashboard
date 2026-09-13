import { beforeEach, describe, expect, it, vi } from "vitest";
import { USAGE_FEATURES } from "./featureUsage";

const DAY = 24 * 60 * 60 * 1000;

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSession: vi.fn(),
  tables: {} as Record<string, unknown[]>,
}));

vi.mock("./supabase", () => ({ isSupabaseConfigured: true, auth: { getSession: mocks.getSession } }));
vi.mock("./supabaseData", () => ({ getSupabaseDataClient: vi.fn(async () => ({ from: mocks.from })) }));
// 端末のデータは、名前を問わず mocks.tables の中身を返す表として置く。
vi.mock("../db/schema", () => ({
  db: new Proxy({}, { get: (_target, name) => ({ toArray: async () => mocks.tables[String(name)] ?? [] }) }),
}));

interface Call {
  table: string;
  select?: unknown[];
  gte?: [string, string];
  eq?: [string, unknown];
  or?: string;
}

/** supabase.from(表).select(...).gte(...).eq(...) の代わり。await した時に answer の結果を返す。 */
function serverAnswers(answer: (call: Call) => { count: number | null; error: { message: string } | null }): Call[] {
  const calls: Call[] = [];
  mocks.from.mockImplementation((table: string) => {
    const call: Call = { table };
    calls.push(call);
    const query: Record<string, unknown> = {};
    query.select = vi.fn((...args: unknown[]) => {
      call.select = args;
      return query;
    });
    query.gte = vi.fn((column: string, value: string) => {
      call.gte = [column, value];
      return query;
    });
    query.eq = vi.fn((column: string, value: unknown) => {
      call.eq = [column, value];
      return query;
    });
    query.or = vi.fn((filter: string) => {
      call.or = filter;
      return query;
    });
    query.then = (resolve: (value: unknown) => void) => resolve(answer(call));
    return query;
  });
  return calls;
}

function features(...ids: string[]) {
  return USAGE_FEATURES.filter((feature) => ids.includes(feature.id));
}

const client = () => ({ from: mocks.from }) as never;

describe("countServerUsage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.tables = {};
  });

  it("30日・90日・これまでの3つを件数だけで数え、機能の絞り込みを付ける", async () => {
    const now = Date.UTC(2026, 8, 13, 3, 0, 0);
    const since30 = new Date(now - 30 * DAY).toISOString();
    const since90 = new Date(now - 90 * DAY).toISOString();
    const calls = serverAnswers((call) => ({
      count: call.gte?.[1] === since30 ? 0 : call.gte?.[1] === since90 ? 82 : 90,
      error: null,
    }));
    const { countServerUsage } = await import("./featureUsageSource");

    const counts = await countServerUsage(client(), features("expense"), now);

    expect(counts.expense).toEqual({ last30: 0, last90: 82, ever: 90 });
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.table).toBe("transactions");
      expect(call.select).toEqual(["*", { count: "exact", head: true }]);
      expect(call.gte?.[0]).toBe("created_at");
      expect(call.eq).toEqual(["type", "expense"]);
    }
  });

  it("種類が空の古いメモも「メモ」に入れる", async () => {
    const calls = serverAnswers(() => ({ count: 1, error: null }));
    const { countServerUsage } = await import("./featureUsageSource");

    await countServerUsage(client(), features("memo"));

    expect(calls.every((call) => call.or === "type.is.null,type.eq.memo")).toBe(true);
  });

  it("Gmailの既読は、既読にした時刻の列で数える", async () => {
    const calls = serverAnswers(() => ({ count: 5, error: null }));
    const { countServerUsage } = await import("./featureUsageSource");

    const counts = await countServerUsage(client(), features("gmailRead"));

    expect(counts.gmailRead).toEqual({ last30: 5, last90: 5, ever: 5 });
    expect(calls.every((call) => call.table === "gmail_message_state" && call.gte?.[0] === "read_at")).toBe(true);
  });

  it("表が無いなどで数えられない機能だけを外し、他は数える", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    serverAnswers((call) =>
      call.table === "category_budgets"
        ? { count: null, error: { message: 'relation "category_budgets" does not exist' } }
        : { count: 1, error: null },
    );
    const { countServerUsage } = await import("./featureUsageSource");

    const counts = await countServerUsage(client(), features("categoryBudget", "event"));

    expect(counts.categoryBudget).toBeNull();
    expect(counts.event).toEqual({ last30: 1, last90: 1, ever: 1 });
  });
});

describe("loadUsageSnapshot", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.tables = {};
  });

  it("ログインしていれば Supabase で数える", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    serverAnswers(() => ({ count: 2, error: null }));
    const { loadUsageSnapshot } = await import("./featureUsageSource");

    const snapshot = await loadUsageSnapshot({ force: true });

    expect(snapshot.source).toBe("server");
    expect(snapshot.scope).toBe("user-1");
    expect(snapshot.counts.fixedCost).toEqual({ last30: 2, last90: 2, ever: 2 });
  });

  it("ログインしていなければ、端末のデータで数える(作った日時の無い固定費は数えない)", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    const now = Date.now();
    mocks.tables = {
      calendarEvents: [{ createdAt: now - DAY }],
      syncedEmails: [{ readAt: now - 2 * DAY }, { readAt: undefined }],
    };
    const { loadUsageSnapshot } = await import("./featureUsageSource");

    const snapshot = await loadUsageSnapshot({ force: true });

    expect(snapshot.source).toBe("local");
    expect(snapshot.counts.event).toEqual({ last30: 1, last90: 1, ever: 1 });
    expect(snapshot.counts.gmailRead).toEqual({ last30: 1, last90: 1, ever: 1 });
    expect(snapshot.counts.fixedCost).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("Supabase に1つも届かなければ、端末のデータで数える", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    serverAnswers(() => ({ count: null, error: { message: "Failed to fetch" } }));
    const { loadUsageSnapshot } = await import("./featureUsageSource");

    const snapshot = await loadUsageSnapshot({ force: true });

    expect(snapshot.source).toBe("local");
  });
});

/** 端末の localStorage の代わり(テストは node で動くので本物が無い)。 */
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("loadUsageSnapshot の覚え方", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", memoryStorage());
    mocks.tables = {};
  });

  it("Supabase で数えた結果は、その日のうちは覚えておいて問い合わせ直さない", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    serverAnswers(() => ({ count: 2, error: null }));
    const { loadUsageSnapshot } = await import("./featureUsageSource");

    await loadUsageSnapshot();
    const callsAfterFirst = mocks.from.mock.calls.length;
    const second = await loadUsageSnapshot();

    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(mocks.from.mock.calls.length).toBe(callsAfterFirst);
    expect(second.source).toBe("server");
  });

  it("端末のデータで数えた結果は覚えず、あとから足した記録も次に開いた時に数える", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    const { loadUsageSnapshot } = await import("./featureUsageSource");

    const before = await loadUsageSnapshot();
    mocks.tables = { calendarEvents: [{ createdAt: Date.now() }] };
    const after = await loadUsageSnapshot();

    expect(before.counts.event).toEqual({ last30: 0, last90: 0, ever: 0 });
    expect(after.counts.event).toEqual({ last30: 1, last90: 1, ever: 1 });
  });
});
