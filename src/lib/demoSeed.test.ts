import { describe, expect, it } from "vitest";
import type { LifeHubDB } from "../db/schema";
import { DEMO_TRIP_ID, seedDemoData } from "./demoSeed";

/** 本物の IndexedDB の代わりに、表ごとに「空にした」「入れた行」を覚えるだけの入れ物。 */
function fakeDb() {
  const rows: Record<string, unknown[]> = {};
  const cleared: string[] = [];
  const table = (name: string) => ({
    name,
    clear: async () => {
      cleared.push(name);
      rows[name] = [];
    },
    bulkPut: async (items: unknown[]) => {
      rows[name] = [...(rows[name] ?? []), ...items];
    },
  });
  const tables = new Map<string, ReturnType<typeof table>>();
  const get = (name: string) => {
    if (!tables.has(name)) tables.set(name, table(name));
    return tables.get(name)!;
  };
  const db = new Proxy(
    {
      table: get,
      transaction: async (_mode: string, _tables: unknown, fn: () => Promise<void>) => fn(),
    },
    { get: (target, prop: string) => (prop in target ? target[prop as keyof typeof target] : get(prop)) },
  );
  return { db: db as unknown as LifeHubDB, rows, cleared };
}

describe("デモの見本のデータ", () => {
  const today = new Date(2026, 10, 26, 9, 0); // 2026-11-26(木)

  it("全画面ぶんの表を、一度空にしてから入れ直す(何度入れても同じ絵になる)", async () => {
    const { db, rows, cleared } = fakeDb();
    await seedDemoData(db, today);
    await seedDemoData(db, today);

    for (const name of ["calendarEvents", "tasks", "transactions", "fixedCosts", "notes", "trips", "tripSchedule", "syncedEmails"]) {
      expect(cleared).toContain(name);
      expect((rows[name] ?? []).length).toBeGreaterThan(0);
    }
    // 就活の見本は入れない(デモは応募先の企業にも見せる。2026-11-27)。表は空にして、前の見本も残さない。
    expect(cleared).toContain("jobApplications");
    expect(rows.jobApplications ?? []).toHaveLength(0);
    // 2回入れても増えない。
    expect(rows.calendarEvents).toHaveLength(7);
    expect(rows.trips).toHaveLength(2);
  });

  it("日付は今日からの相対で入る(いつ開いても今週の予定に見える)", async () => {
    const { db, rows } = fakeDb();
    await seedDemoData(db, today);
    const events = rows.calendarEvents as Array<{ title: string; date: string }>;
    expect(events.find((e) => e.title === "チームの定例")?.date).toBe("2026-11-26");
    expect(events.find((e) => e.title === "友人と夕食")?.date).toBe("2026-11-27");
    const trip = (rows.trips as Array<{ id: string; startDate: string }>).find((t) => t.id === DEMO_TRIP_ID);
    expect(trip?.startDate).toBe("2026-12-02");
  });

  it("メモのチェック項目・買い物の項目は、画面が読む名前で入る", async () => {
    const { db, rows } = fakeDb();
    await seedDemoData(db, today);
    const notes = rows.notes as Array<{
      type: string;
      checklistItems?: Array<{ title?: string }>;
      shoppingItems?: Array<{ name?: string; purchased?: boolean }>;
    }>;
    const checklist = notes.find((n) => n.type === "checklist");
    const shopping = notes.find((n) => n.type === "shopping");
    expect(checklist?.checklistItems?.map((i) => i.title)).toEqual(["住所変更", "ネット回線の移転", "粗大ごみの申し込み"]);
    expect(shopping?.shoppingItems?.find((i) => i.name === "洗剤")?.purchased).toBe(true);
  });

  it("今月の給料が入っていて、ホームの「今月あと使える」がマイナスの見本にならない", async () => {
    const { db, rows } = fakeDb();
    await seedDemoData(db, today);
    const salaries = rows.salaries as Array<{ month: string; amount: number }>;
    expect(salaries.find((s) => s.month === "2026-11")?.amount).toBe(268000);
    expect(salaries.find((s) => s.month === "2026-10")).toBeTruthy();
  });
});
