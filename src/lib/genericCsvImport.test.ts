import { describe, expect, it } from "vitest";
import { parseCsvRows } from "./csv";
import { buildPreview, mapCsvRowsToTransactions, type ColumnMapping } from "./genericCsvImport";

const SIGNED_CSV = [
  "日付,内容,金額,店舗",
  "2026/07/01,ランチ,-1200,カフェA",
  "2026/07/02,給与振込,300000,会社",
  "2026/07/03,返金,500,カフェA",
].join("\n");

const SPLIT_CSV = [
  "取引日,摘要,出金,入金",
  "2026/07/01,スーパー,3000,",
  "2026/07/02,給与,,250000",
  "2026/07/03,空行,,",
].join("\n");

function baseSignedMapping(overrides: Partial<ColumnMapping> = {}): ColumnMapping {
  return {
    hasHeaderRow: true,
    dateColumn: 0,
    amount: { kind: "signed", column: 2, positiveType: "income" },
    descriptionColumn: 1,
    storeColumn: 3,
    defaultExpenseCategory: "その他",
    defaultIncomeCategory: "その他",
    ...overrides,
  };
}

function baseSplitMapping(overrides: Partial<ColumnMapping> = {}): ColumnMapping {
  return {
    hasHeaderRow: true,
    dateColumn: 0,
    amount: { kind: "split", outflowColumn: 2, inflowColumn: 3 },
    descriptionColumn: 1,
    defaultExpenseCategory: "その他",
    defaultIncomeCategory: "その他",
    ...overrides,
  };
}

describe("buildPreview", () => {
  const rows = parseCsvRows(SIGNED_CSV);

  it("separates the header row from data rows when hasHeaderRow is true", () => {
    const preview = buildPreview(rows, true);
    expect(preview.header).toEqual(["日付", "内容", "金額", "店舗"]);
    expect(preview.totalDataRows).toBe(3);
  });

  it("treats every row as data when hasHeaderRow is false", () => {
    const preview = buildPreview(rows, false);
    expect(preview.header).toBeNull();
    expect(preview.totalDataRows).toBe(4);
  });

  it("caps sampleRows at the requested size", () => {
    const preview = buildPreview(rows, true, 2);
    expect(preview.sampleRows).toHaveLength(2);
  });
});

describe("mapCsvRowsToTransactions — signed amount mode", () => {
  const rows = parseCsvRows(SIGNED_CSV);

  it("flips type on a negative amount relative to positiveType", () => {
    const result = mapCsvRowsToTransactions(rows, baseSignedMapping());
    expect(result.rows[0].transaction).toMatchObject({ type: "expense", amount: 1200, date: "2026-07-01" });
  });

  it("uses positiveType directly for a positive amount", () => {
    const result = mapCsvRowsToTransactions(rows, baseSignedMapping());
    expect(result.rows[1].transaction).toMatchObject({ type: "income", amount: 300000 });
  });

  it("flips consistently when positiveType is set to expense instead", () => {
    const result = mapCsvRowsToTransactions(
      rows,
      baseSignedMapping({ amount: { kind: "signed", column: 2, positiveType: "expense" } }),
    );
    // row 0 is negative (-1200) -> opposite(expense) = income
    expect(result.rows[0].transaction.type).toBe("income");
    // row 1 is positive (300000) -> positiveType directly = expense
    expect(result.rows[1].transaction.type).toBe("expense");
  });

  it("applies defaultMethod only to expense rows", () => {
    const result = mapCsvRowsToTransactions(rows, baseSignedMapping({ defaultMethod: "クレジットカード" }));
    const expenseRow = result.rows.find((r) => r.transaction.type === "expense")!;
    const incomeRow = result.rows.find((r) => r.transaction.type === "income")!;
    expect(expenseRow.transaction.method).toBe("クレジットカード");
    expect(incomeRow.transaction.method).toBeUndefined();
  });

  it("leaves memo/store undefined when the columns aren't mapped", () => {
    const result = mapCsvRowsToTransactions(rows, baseSignedMapping({ descriptionColumn: undefined, storeColumn: undefined }));
    expect(result.rows[0].transaction.memo).toBeUndefined();
    expect(result.rows[0].transaction.store).toBeUndefined();
  });
});

describe("mapCsvRowsToTransactions — split amount mode", () => {
  const rows = parseCsvRows(SPLIT_CSV);

  it("treats an outflow-only row as an expense", () => {
    const result = mapCsvRowsToTransactions(rows, baseSplitMapping());
    expect(result.rows[0].transaction).toMatchObject({ type: "expense", amount: 3000 });
  });

  it("treats an inflow-only row as income", () => {
    const result = mapCsvRowsToTransactions(rows, baseSplitMapping());
    expect(result.rows[1].transaction).toMatchObject({ type: "income", amount: 250000 });
  });

  it("skips a row where both outflow and inflow are empty as unparseable", () => {
    const result = mapCsvRowsToTransactions(rows, baseSplitMapping());
    expect(result.rows).toHaveLength(2);
    expect(result.skippedUnparseable).toBe(1);
  });

  it("prefers expense when both outflow and inflow are present on the same row", () => {
    const bothCsv = ["日付,出金,入金", "2026/07/01,1000,500"].join("\n");
    const result = mapCsvRowsToTransactions(parseCsvRows(bothCsv), {
      hasHeaderRow: true,
      dateColumn: 0,
      amount: { kind: "split", outflowColumn: 1, inflowColumn: 2 },
      defaultExpenseCategory: "その他",
      defaultIncomeCategory: "その他",
    });
    expect(result.rows[0].transaction).toMatchObject({ type: "expense", amount: 1000 });
  });
});

describe("mapCsvRowsToTransactions — date parsing", () => {
  const twoColumnMapping = baseSignedMapping({
    amount: { kind: "signed", column: 1, positiveType: "income" },
    descriptionColumn: undefined,
    storeColumn: undefined,
  });

  it("accepts YYYY/MM/DD, YYYY-MM-DD, and YYYY.MM.DD, dropping a trailing time", () => {
    const csv = ["日付,金額", "2026/07/01 10:00,100", "2026-07-02,100", "2026.07.03,100"].join("\n");
    const result = mapCsvRowsToTransactions(parseCsvRows(csv), twoColumnMapping);
    expect(result.rows.map((r) => r.transaction.date)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
  });

  it("counts an unrecognized date format as unparseable rather than guessing", () => {
    const csv = ["日付,金額", "07/01/2026,100"].join("\n");
    const result = mapCsvRowsToTransactions(parseCsvRows(csv), twoColumnMapping);
    expect(result.rows).toHaveLength(0);
    expect(result.skippedUnparseable).toBe(1);
  });
});

describe("mapCsvRowsToTransactions — dedup determinism", () => {
  it("produces identical externalId sets when run twice on the same input", () => {
    const rows = parseCsvRows(SIGNED_CSV);
    const first = mapCsvRowsToTransactions(rows, baseSignedMapping());
    const second = mapCsvRowsToTransactions(rows, baseSignedMapping());
    expect(second.rows.map((r) => r.externalId)).toEqual(first.rows.map((r) => r.externalId));
  });

  it("gives repeated identical rows within one file distinct externalIds via a trailing occurrence index", () => {
    const csv = ["日付,内容,金額", "2026/07/01,コーヒー,-500", "2026/07/01,コーヒー,-500"].join("\n");
    const result = mapCsvRowsToTransactions(parseCsvRows(csv), baseSignedMapping({ storeColumn: undefined }));
    const [first, second] = result.rows;
    expect(first.externalId).not.toBe(second.externalId);
    expect(first.externalId.replace(/:\d+$/, "")).toBe(second.externalId.replace(/:\d+$/, ""));
  });
});
