// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdomのFile/Blobはtext()を実装していないため、importBackupが呼ぶ.text()だけを
// 持つ最小限の偽Fileでテストする。
function fakeFile(content: string): File {
  return { text: async () => content } as unknown as File;
}

const BACKUP_TABLE_NAMES = [
  "transactions",
  "fixedCosts",
  "calendarEvents",
  "tasks",
  "notes",
  "settings",
  "salaries",
  "trips",
  "tripSchedule",
  "tripExpenses",
  "tripPackingItems",
  "tripRoutePlaces",
  "diaryEntries",
  "paypayTransactions",
  "savingsGoals",
  "jobApplications",
] as const;

// Dexieの実体(IndexedDB)はテストでは開けないので、使う操作(toArray/clear/bulkAdd)だけを
// 持つ配列ベースの偽テーブルに差し替える(src/lib/crossAccountEvents.test.tsと同じ方針)。
const mocks = vi.hoisted(() => {
  const stores = new Map<string, Record<string, unknown>[]>();
  for (const name of [
    "transactions",
    "fixedCosts",
    "calendarEvents",
    "tasks",
    "notes",
    "settings",
    "salaries",
    "trips",
    "tripSchedule",
    "tripExpenses",
    "tripPackingItems",
    "tripRoutePlaces",
    "diaryEntries",
    "paypayTransactions",
    "savingsGoals",
    "jobApplications",
  ]) {
    stores.set(name, []);
  }
  return { stores };
});

vi.mock("../db/schema", () => {
  function fakeTable(name: string) {
    return {
      toArray: async () => mocks.stores.get(name) ?? [],
      clear: async () => {
        mocks.stores.set(name, []);
      },
      bulkAdd: async (rows: Record<string, unknown>[]) => {
        mocks.stores.get(name)!.push(...rows);
      },
      add: async (row: Record<string, unknown>) => {
        mocks.stores.get(name)!.push(row);
      },
    };
  }
  return {
    db: {
      table: (name: string) => fakeTable(name),
      savingsGoals: fakeTable("savingsGoals"),
      transaction: async (_mode: string, _tables: unknown[], callback: () => Promise<void>) => callback(),
    },
  };
});

describe("バックアップの書き出し", () => {
  beforeEach(() => {
    for (const name of mocks.stores.keys()) mocks.stores.set(name, []);
    vi.restoreAllMocks();
  });

  it("16テーブルすべてを書き出す", async () => {
    mocks.stores.set("trips", [{ id: "trip-1", name: "沖縄" }]);
    mocks.stores.set("diaryEntries", [{ id: "diary-1", date: "2026-08-01", body: "楽しかった" }]);

    // jsdomにはURL.createObjectURLが無いので、直接差し替える。中身の検証は
    // Blobを介さず、Blobコンストラクタへ渡された文字列をそのまま捕まえて行う。
    let capturedText = "";
    const OriginalBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class extends OriginalBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          capturedText = String(parts[0]);
        }
      },
    );
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { exportBackup } = await import("./backup");
    await exportBackup();

    expect(clickSpy).toHaveBeenCalledOnce();
    const payload = JSON.parse(capturedText);
    expect(payload.version).toBe(2);
    for (const table of BACKUP_TABLE_NAMES) {
      expect(payload.data).toHaveProperty(table);
    }
    expect(payload.data.trips).toEqual([{ id: "trip-1", name: "沖縄" }]);
    expect(payload.data.diaryEntries).toEqual([{ id: "diary-1", date: "2026-08-01", body: "楽しかった" }]);
  });
});

describe("バックアップの復元", () => {
  beforeEach(() => {
    for (const name of mocks.stores.keys()) mocks.stores.set(name, []);
  });

  it("16テーブルすべてを、書き出したファイルの内容で置き換える", async () => {
    mocks.stores.set("transactions", [{ id: "old" }]);

    const file = fakeFile(
      JSON.stringify({
        version: 2,
        data: {
          transactions: [{ id: "t1", amount: 100 }],
          trips: [{ id: "trip-1", name: "沖縄" }],
          diaryEntries: [{ id: "diary-1", date: "2026-08-01", body: "楽しかった" }],
          paypayTransactions: [{ id: "pp-1", amount: 500 }],
        },
      }),
    );

    const { importBackup } = await import("./backup");
    await importBackup(file);

    expect(mocks.stores.get("transactions")).toEqual([{ id: "t1", amount: 100 }]);
    expect(mocks.stores.get("trips")).toEqual([{ id: "trip-1", name: "沖縄" }]);
    expect(mocks.stores.get("diaryEntries")).toEqual([{ id: "diary-1", date: "2026-08-01", body: "楽しかった" }]);
    expect(mocks.stores.get("paypayTransactions")).toEqual([{ id: "pp-1", amount: 500 }]);
    // ファイルに含まれていなかったテーブルは、既存データごと空に揃える。
    expect(mocks.stores.get("fixedCosts")).toEqual([]);
  });

  it("旧形式(6テーブルのみ)のファイルも、無い分は空として復元できる", async () => {
    mocks.stores.set("trips", [{ id: "old-trip" }]);

    const file = fakeFile(
      JSON.stringify({
        version: 1,
        data: {
          transactions: [{ id: "t1" }],
          fixedCosts: [],
          calendarEvents: [],
          tasks: [],
          notes: [],
          settings: [{ monthlyIncome: 300000 }],
        },
      }),
    );

    const { importBackup } = await import("./backup");
    await importBackup(file);

    expect(mocks.stores.get("transactions")).toEqual([{ id: "t1" }]);
    expect(mocks.stores.get("settings")).toEqual([{ monthlyIncome: 300000 }]);
    // 旧ファイルに無かったtripsは、既存の端末内データごと空になる(書き出し時点に無かった扱い)。
    expect(mocks.stores.get("trips")).toEqual([]);
  });

  it("貯金目標が1つだった頃のファイルは、設定の目標額を1件目の目標として引き継ぐ", async () => {
    const file = fakeFile(
      JSON.stringify({
        version: 2,
        data: { settings: [{ monthlyIncome: 300000, savingsGoalMonthly: 40000 }] },
      }),
    );

    const { importBackup } = await import("./backup");
    await importBackup(file);

    expect(mocks.stores.get("savingsGoals")).toHaveLength(1);
    expect(mocks.stores.get("savingsGoals")![0]).toMatchObject({ name: "貯金目標", monthlyAmount: 40000 });
  });

  it("目標額が未設定(0)なら、引き継ぎで空の目標を作らない", async () => {
    const file = fakeFile(
      JSON.stringify({ version: 2, data: { settings: [{ monthlyIncome: 300000, savingsGoalMonthly: 0 }] } }),
    );

    const { importBackup } = await import("./backup");
    await importBackup(file);

    expect(mocks.stores.get("savingsGoals")).toEqual([]);
  });

  it("新しい形式(savingsGoals入り)のファイルでは、設定の古い目標額を引き継がない", async () => {
    const file = fakeFile(
      JSON.stringify({
        version: 2,
        data: {
          settings: [{ savingsGoalMonthly: 40000 }],
          savingsGoals: [{ id: "g1", name: "旅行用", monthlyAmount: 30000, createdAt: 1 }],
        },
      }),
    );

    const { importBackup } = await import("./backup");
    await importBackup(file);

    expect(mocks.stores.get("savingsGoals")).toEqual([{ id: "g1", name: "旅行用", monthlyAmount: 30000, createdAt: 1 }]);
  });
});
