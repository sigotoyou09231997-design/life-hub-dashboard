// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 他人と一緒に編集する旅行(supabase/sql/034_trip_members.sql)の、同期まわり。
 * サーバーは「表ごとの行の一覧」と「参加状況」だけの代わりを用意し、Dexie の表はメモリ上の代わりで確かめる。
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return {
    channel,
    server: {
      /** 表名 → サーバーにある行(snake_case)。 */
      tables: {} as Record<string, Row[]>,
      /** trip_members の問い合わせを失敗させる(034 が無い・通信できない)。 */
      membersError: null as { message: string } | null,
      /** 名前を入れた表の「旅行を指定した取得」を失敗させる。 */
      failTables: new Set<string>(),
      upserts: [] as { table: string; row: Row }[],
      selects: [] as { table: string; filters: unknown[] }[],
    },
    channelNames: [] as string[],
    removeChannel: vi.fn(),
    queueEntries: [] as { id: number; table: string; rowId: string; op: string; queuedAt: number }[],
    queueDeleted: [] as [string, string][],
  };
});

function chain(table: string) {
  const filters: unknown[][] = [];
  let incremental = false;
  const result = () => {
    mocks.server.selects.push({ table, filters: [...filters] });
    if (table === "trip_members" && mocks.server.membersError) return { data: null, error: mocks.server.membersError };
    if (incremental) return { data: [], error: null }; // いつもの差分の取り込みは、ここでは空
    if (mocks.server.failTables.has(table)) return { data: null, error: { message: "network failed" } };
    const rows = (mocks.server.tables[table] ?? []).filter((row) =>
      filters.every(([op, column, value]) => (op === "eq" ? row[column as string] === value : (value as unknown[]).includes(row[column as string]))),
    );
    return { data: rows, error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (column: string, value: unknown) => (filters.push(["eq", column, value]), q),
    in: (column: string, value: unknown[]) => (filters.push(["in", column, value]), q),
    gte: () => ((incremental = true), q),
    upsert: async (row: Row) => (mocks.server.upserts.push({ table, row }), { error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve(result()),
  };
  return q;
}

vi.mock("./supabaseData", () => ({
  getSupabaseDataClient: vi.fn(async () => ({
    from: (table: string) => chain(table),
    channel: (name: string) => (mocks.channelNames.push(name), mocks.channel),
    removeChannel: mocks.removeChannel,
    realtime: { setAuth: vi.fn() },
  })),
}));
vi.mock("../db/schema", () => ({
  db: {
    syncQueue: {
      toArray: vi.fn(async () => [...mocks.queueEntries]),
      count: vi.fn(async () => mocks.queueEntries.length),
      delete: vi.fn(async (id: number) => {
        mocks.queueEntries = mocks.queueEntries.filter((entry) => entry.id !== id);
      }),
      update: vi.fn(),
      add: vi.fn(),
      where: vi.fn(() => ({
        equals: vi.fn(([table, rowId]: [string, string]) => ({
          delete: vi.fn(async () => {
            mocks.queueDeleted.push([table, rowId]);
          }),
          first: vi.fn(async () => undefined),
        })),
      })),
    },
  },
}));
vi.mock("./deviceId", () => ({ getDeviceId: () => "device-1" }));

function fakeTable() {
  const rows = new Map<string, Row>();
  return {
    rows,
    hook: vi.fn(),
    get: vi.fn(async (id: string) => rows.get(id)),
    add: vi.fn(async (row: Row) => (rows.set(row.id as string, row), row.id)),
    update: vi.fn(async (id: string, changes: Row) => (rows.set(id, { ...rows.get(id), ...changes }), 1)),
    delete: vi.fn(async (id: string) => void rows.delete(id)),
    bulkDelete: vi.fn(async (ids: string[]) => void ids.forEach((id) => rows.delete(id))),
    where: (field: string) => ({
      equals: (value: unknown) => ({ primaryKeys: async () => [...rows.values()].filter((r) => r[field] === value).map((r) => r.id as string) }),
      anyOf: (values: unknown[]) => ({ primaryKeys: async () => [...rows.values()].filter((r) => values.includes(r[field])).map((r) => r.id as string) }),
    }),
  };
}

const ME = "user-me";
const OWNER = "user-owner";
const SHARED = "trip-shared";
const MINE = "trip-mine";

async function setup() {
  const sync = await import("./sync");
  const tables = {
    trips: fakeTable(),
    trip_schedule: fakeTable(),
    trip_expenses: fakeTable(),
    trip_packing_items: fakeTable(),
    trip_route_places: fakeTable(),
    trip_expense_currencies: fakeTable(),
  };
  for (const [name, table] of Object.entries(tables)) sync.registerSyncedTable(table as never, name);
  return { sync, tables };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("他人と一緒に編集する旅行の同期", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.channel.on.mockReturnValue(mocks.channel);
    mocks.channel.subscribe.mockReturnValue(mocks.channel);
    mocks.server.tables = {};
    mocks.server.membersError = null;
    mocks.server.failTables = new Set();
    mocks.server.upserts = [];
    mocks.server.selects = [];
    mocks.channelNames = [];
    mocks.queueEntries = [];
    mocks.queueDeleted = [];
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    localStorage.clear();
  });

  describe("送る時", () => {
    it("共有された旅行の行は持ち主の名前で、自分の旅行の行は自分の名前で送る", async () => {
      localStorage.setItem("lifeHubLastSynced:__shared_trip_owners", JSON.stringify({ [SHARED]: OWNER }));
      mocks.queueEntries = [
        { id: 1, table: "trip_schedule", rowId: "s-shared", op: "upsert", queuedAt: 1 },
        { id: 2, table: "trip_schedule", rowId: "s-mine", op: "upsert", queuedAt: 2 },
        { id: 3, table: "trips", rowId: SHARED, op: "upsert", queuedAt: 3 },
        { id: 4, table: "trip_expense_currencies", rowId: "c-shared", op: "upsert", queuedAt: 4 },
      ];
      const { sync, tables } = await setup();
      tables.trip_schedule.rows.set("s-shared", { id: "s-shared", tripId: SHARED, userId: ME, title: "うどん" });
      tables.trip_schedule.rows.set("s-mine", { id: "s-mine", tripId: MINE, userId: ME, title: "自分の" });
      tables.trips.rows.set(SHARED, { id: SHARED, userId: OWNER, name: "共有の旅" });
      tables.trip_expenses.rows.set("e-shared", { id: "e-shared", tripId: SHARED });
      tables.trip_expense_currencies.rows.set("c-shared", { id: "c-shared", expenseId: "e-shared", userId: ME });
      await sync.startSession(ME, "token");

      const byRow = (id: string) => mocks.server.upserts.find((u) => u.row.id === id)!.row;
      expect(byRow("s-shared").user_id).toBe(OWNER);
      expect(byRow("s-mine").user_id).toBe(ME);
      expect(byRow(SHARED).user_id).toBe(OWNER);
      expect(byRow("c-shared").user_id).toBe(OWNER);
    });

    it("共有された旅行が無ければ、全部いつもどおり自分の名前で送る(行に残った別の user_id を信じない)", async () => {
      mocks.queueEntries = [{ id: 1, table: "trip_schedule", rowId: "s1", op: "upsert", queuedAt: 1 }];
      const { sync, tables } = await setup();
      tables.trip_schedule.rows.set("s1", { id: "s1", tripId: "trip-x", userId: "someone-else", title: "x" });
      await sync.startSession(ME, "token");
      expect(mocks.server.upserts[0].row.user_id).toBe(ME);
    });
  });

  describe("参加した旅行を取り込む", () => {
    function shareOnServer() {
      mocks.server.tables = {
        trip_members: [{ trip_id: SHARED, owner_id: OWNER, member_id: ME, status: "accepted" }],
        trips: [{ id: SHARED, user_id: OWNER, name: "みんなの旅", device_id: "owner-pc", updated_at: "2026-10-01T00:00:00Z" }],
        trip_schedule: [{ id: "s1", trip_id: SHARED, user_id: OWNER, title: "羽田発", device_id: "owner-pc", updated_at: "2026-10-01T00:00:00Z" }],
        trip_expenses: [{ id: "e1", trip_id: SHARED, user_id: OWNER, title: "うどん", device_id: "owner-pc", updated_at: "2026-10-01T00:00:00Z" }],
        trip_packing_items: [],
        trip_route_places: [{ id: "r1", trip_id: SHARED, user_id: OWNER, name: "栗林公園", device_id: "owner-pc", updated_at: "2026-10-01T00:00:00Z" }],
        trip_expense_currencies: [{ id: "c1", expense_id: "e1", user_id: OWNER, currency: "EUR", device_id: "owner-pc", updated_at: "2026-10-01T00:00:00Z" }],
      };
    }

    it("初めて見る共有の旅行は、過去ぶんまで全部(旅行・日程・費用・ルート・通貨の内訳)取り込み、共有の印を残す", async () => {
      shareOnServer();
      const { sync, tables } = await setup();
      await sync.startSession(ME, "token");
      await sync.refreshSharedTrips();

      expect(tables.trips.rows.get(SHARED)).toMatchObject({ id: SHARED, userId: OWNER, name: "みんなの旅" });
      expect(tables.trip_schedule.rows.get("s1")).toMatchObject({ tripId: SHARED, userId: OWNER, title: "羽田発" });
      expect(tables.trip_expenses.rows.get("e1")).toMatchObject({ title: "うどん" });
      expect(tables.trip_route_places.rows.get("r1")).toMatchObject({ name: "栗林公園" });
      expect(tables.trip_expense_currencies.rows.get("c1")).toMatchObject({ expenseId: "e1", currency: "EUR" });
      expect(JSON.parse(localStorage.getItem("lifeHubLastSynced:__shared_trip_owners")!)).toEqual({ [SHARED]: OWNER });
      expect(JSON.parse(localStorage.getItem("lifeHubLastSynced:__shared_trips_seen")!)).toEqual([SHARED]);
    });

    it("取り込み済みの旅行は、次からは全部取り直さない", async () => {
      shareOnServer();
      const { sync } = await setup();
      await sync.startSession(ME, "token");
      await sync.refreshSharedTrips();
      const tripPulls = () => mocks.server.selects.filter((s) => s.table === "trips" && s.filters.length > 0).length;
      const before = tripPulls();
      expect(before).toBe(1);
      await sync.refreshSharedTrips();
      expect(tripPulls()).toBe(before);
    });

    it("取り込みの途中で失敗したら、何も入れず・印も付けず、次の機会にもう一度やる", async () => {
      shareOnServer();
      mocks.server.failTables = new Set(["trip_expenses"]);
      const { sync, tables } = await setup();
      await sync.startSession(ME, "token");
      await sync.refreshSharedTrips();
      expect(tables.trips.rows.size).toBe(0);
      expect(tables.trip_schedule.rows.size).toBe(0);
      expect(JSON.parse(localStorage.getItem("lifeHubLastSynced:__shared_trips_seen") ?? "[]")).toEqual([]);

      mocks.server.failTables = new Set();
      await sync.refreshSharedTrips();
      expect(tables.trips.rows.has(SHARED)).toBe(true);
      expect(JSON.parse(localStorage.getItem("lifeHubLastSynced:__shared_trips_seen")!)).toEqual([SHARED]);
    });

    it("共有の旅行があるときだけ、絞り込み無しのリアルタイム購読を足す。招待の購読は、034 があれば常に足す", async () => {
      const { sync } = await setup();
      await sync.startSession(ME, "token");
      await sync.refreshSharedTrips();
      expect(mocks.channelNames).toContain(`trip_members-${ME}`);
      expect(mocks.channelNames.some((name) => name.includes("-shared-"))).toBe(false);

      shareOnServer();
      await sync.refreshSharedTrips();
      for (const table of ["trips", "trip_schedule", "trip_expenses", "trip_packing_items", "trip_route_places", "trip_expense_currencies"]) {
        expect(mocks.channelNames).toContain(`${table}-shared-${ME}`);
      }
    });

    it("034 が無い・通信できない時は、何も変えない(旅行も、取り込み済みの印も、そのまま)", async () => {
      localStorage.setItem("lifeHubLastSynced:__shared_trips_seen", JSON.stringify([SHARED]));
      localStorage.setItem("lifeHubLastSynced:__shared_trip_owners", JSON.stringify({ [SHARED]: OWNER }));
      mocks.server.membersError = { message: 'relation "public.trip_members" does not exist' };
      const { sync, tables } = await setup();
      tables.trips.rows.set(SHARED, { id: SHARED, userId: OWNER, name: "みんなの旅" });
      tables.trip_schedule.rows.set("s1", { id: "s1", tripId: SHARED, userId: OWNER });
      await sync.startSession(ME, "token");
      await sync.refreshSharedTrips();

      expect(tables.trips.rows.has(SHARED)).toBe(true);
      expect(tables.trip_schedule.rows.has("s1")).toBe(true);
      expect(JSON.parse(localStorage.getItem("lifeHubLastSynced:__shared_trips_seen")!)).toEqual([SHARED]);
      expect(mocks.channelNames).not.toContain(`trip_members-${ME}`);
    });
  });

  describe("共有が終わった時(外された・抜けた)", () => {
    it("その旅行を、この端末から片付ける(日程・費用・通貨の内訳・送り待ちも)。ほかの旅行は残す", async () => {
      localStorage.setItem("lifeHubLastSynced:__shared_trips_seen", JSON.stringify([SHARED]));
      localStorage.setItem("lifeHubLastSynced:__shared_trip_owners", JSON.stringify({ [SHARED]: OWNER }));
      const { sync, tables } = await setup();
      tables.trips.rows.set(SHARED, { id: SHARED, userId: OWNER, name: "共有の旅" });
      tables.trips.rows.set(MINE, { id: MINE, userId: ME, name: "自分の旅" });
      tables.trip_schedule.rows.set("s-shared", { id: "s-shared", tripId: SHARED });
      tables.trip_schedule.rows.set("s-mine", { id: "s-mine", tripId: MINE });
      tables.trip_expenses.rows.set("e-shared", { id: "e-shared", tripId: SHARED });
      tables.trip_expenses.rows.set("e-mine", { id: "e-mine", tripId: MINE });
      tables.trip_expense_currencies.rows.set("c-shared", { id: "c-shared", expenseId: "e-shared" });
      tables.trip_expense_currencies.rows.set("c-mine", { id: "c-mine", expenseId: "e-mine" });
      await sync.startSession(ME, "token"); // 参加状況は空 = もう共有されていない
      await sync.refreshSharedTrips();

      expect([...tables.trips.rows.keys()]).toEqual([MINE]);
      expect([...tables.trip_schedule.rows.keys()]).toEqual(["s-mine"]);
      expect([...tables.trip_expenses.rows.keys()]).toEqual(["e-mine"]);
      expect([...tables.trip_expense_currencies.rows.keys()]).toEqual(["c-mine"]);
      expect(mocks.queueDeleted).toContainEqual(["trip_schedule", "s-shared"]);
      expect(mocks.queueDeleted).toContainEqual(["trips", SHARED]);
      expect(mocks.queueDeleted).not.toContainEqual(["trip_schedule", "s-mine"]);
      // サーバーには何も送らない(片付けは端末の中だけ)
      expect(mocks.server.upserts).toEqual([]);
      expect(JSON.parse(localStorage.getItem("lifeHubLastSynced:__shared_trips_seen")!)).toEqual([]);
      expect(JSON.parse(localStorage.getItem("lifeHubLastSynced:__shared_trip_owners")!)).toEqual({});
    });

    it("自分の旅行は、取り込み済みの印に紛れていても絶対に消さない", async () => {
      localStorage.setItem("lifeHubLastSynced:__shared_trips_seen", JSON.stringify([MINE]));
      const { sync, tables } = await setup();
      tables.trips.rows.set(MINE, { id: MINE, userId: ME, name: "自分の旅" });
      tables.trip_schedule.rows.set("s-mine", { id: "s-mine", tripId: MINE });
      await sync.startSession(ME, "token");
      await sync.refreshSharedTrips();
      expect(tables.trips.rows.has(MINE)).toBe(true);
      expect(tables.trip_schedule.rows.has("s-mine")).toBe(true);
      expect(mocks.queueDeleted).toEqual([]);
    });

    it("持ち主が分からない(user_id が無い)旅行も、消さない", async () => {
      localStorage.setItem("lifeHubLastSynced:__shared_trips_seen", JSON.stringify([MINE]));
      const { sync, tables } = await setup();
      tables.trips.rows.set(MINE, { id: MINE, name: "古い端末の旅" });
      await sync.startSession(ME, "token");
      await sync.refreshSharedTrips();
      expect(tables.trips.rows.has(MINE)).toBe(true);
    });
  });
});
