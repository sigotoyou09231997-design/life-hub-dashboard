import { describe, expect, it } from "vitest";
import { parseCsvRows } from "./csv";
import { parseFlexibleMonthOrDate, mapCsvRowsToSalaries, aggregateDeductions, type SalaryColumnMapping } from "./salaryCsv";
import type { SalaryEntry } from "../types";

describe("parseFlexibleMonthOrDate", () => {
  it("parses a full YYYY/MM/DD date into month + payday", () => {
    expect(parseFlexibleMonthOrDate("2026/08/25")).toEqual({ month: "2026-08", payday: 25 });
  });

  it("parses YYYY-MM-DD", () => {
    expect(parseFlexibleMonthOrDate("2026-08-25")).toEqual({ month: "2026-08", payday: 25 });
  });

  it("parses a Japanese-style full date (年月日)", () => {
    expect(parseFlexibleMonthOrDate("2026年8月25日")).toEqual({ month: "2026-08", payday: 25 });
  });

  it("parses a month-only value with no payday", () => {
    expect(parseFlexibleMonthOrDate("2026年8月")).toEqual({ month: "2026-08", payday: null });
    expect(parseFlexibleMonthOrDate("2026-08")).toEqual({ month: "2026-08", payday: null });
  });

  it("returns null for an unrecognized format", () => {
    expect(parseFlexibleMonthOrDate("August 2026")).toBeNull();
    expect(parseFlexibleMonthOrDate(undefined)).toBeNull();
  });
});

const PAYSLIP_CSV = [
  "支給日,総支給額,健康保険料,厚生年金保険料,雇用保険料,所得税,差引支給額",
  "2026/06/25,350000,17500,32000,1050,7200,292250",
  "2026/07/25,350000,17500,32000,1050,7200,292250",
].join("\n");

function baseMapping(overrides: Partial<SalaryColumnMapping> = {}): SalaryColumnMapping {
  return {
    hasHeaderRow: true,
    dateColumn: 0,
    fallbackPayday: 25,
    netAmountColumn: 6,
    grossAmountColumn: 1,
    deductionColumns: [2, 3, 4, 5],
    ...overrides,
  };
}

describe("mapCsvRowsToSalaries", () => {
  const rows = parseCsvRows(PAYSLIP_CSV);
  const header = rows[0];

  it("maps a payslip row into a SalaryEntry with itemized deductions", () => {
    const result = mapCsvRowsToSalaries(rows, header, baseMapping());
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].entry).toMatchObject({ month: "2026-06", payday: 25, amount: 292250, grossAmount: 350000 });
    expect(result.rows[0].entry.deductions).toEqual([
      { label: "健康保険料", amount: 17500 },
      { label: "厚生年金保険料", amount: 32000 },
      { label: "雇用保険料", amount: 1050 },
      { label: "所得税", amount: 7200 },
    ]);
  });

  it("falls back to fallbackPayday when the date column only yields a month", () => {
    const csv = ["対象年月,差引支給額", "2026年6月,292250"].join("\n");
    const result = mapCsvRowsToSalaries(parseCsvRows(csv), ["対象年月", "差引支給額"], {
      hasHeaderRow: true,
      dateColumn: 0,
      fallbackPayday: 20,
      netAmountColumn: 1,
      deductionColumns: [],
    });
    expect(result.rows[0].entry).toMatchObject({ month: "2026-06", payday: 20 });
  });

  it("omits grossAmount and deductions when not mapped", () => {
    const result = mapCsvRowsToSalaries(rows, header, baseMapping({ grossAmountColumn: undefined, deductionColumns: [] }));
    expect(result.rows[0].entry.grossAmount).toBeUndefined();
    expect(result.rows[0].entry.deductions).toBeUndefined();
  });

  it("counts a row with an unparseable date as skipped", () => {
    const csv = ["支給日,差引支給額", "not-a-date,292250"].join("\n");
    const result = mapCsvRowsToSalaries(parseCsvRows(csv), ["支給日", "差引支給額"], baseMapping({ netAmountColumn: 1, grossAmountColumn: undefined, deductionColumns: [] }));
    expect(result.rows).toHaveLength(0);
    expect(result.skippedUnparseable).toBe(1);
  });

  it("counts a row with a zero/blank net amount as skipped", () => {
    const csv = ["支給日,差引支給額", "2026/06/25,"].join("\n");
    const result = mapCsvRowsToSalaries(parseCsvRows(csv), ["支給日", "差引支給額"], baseMapping({ netAmountColumn: 1, grossAmountColumn: undefined, deductionColumns: [] }));
    expect(result.rows).toHaveLength(0);
    expect(result.skippedUnparseable).toBe(1);
  });
});

describe("aggregateDeductions", () => {
  it("sums totals and counts occurrences per label across salaries", () => {
    const salaries: SalaryEntry[] = [
      {
        month: "2026-06",
        payday: 25,
        amount: 292250,
        createdAt: 0,
        deductions: [
          { label: "健康保険料", amount: 17500 },
          { label: "厚生年金保険料", amount: 32000 },
        ],
      },
      {
        month: "2026-07",
        payday: 25,
        amount: 292250,
        createdAt: 0,
        deductions: [{ label: "健康保険料", amount: 17500 }],
      },
      { month: "2026-05", payday: 25, amount: 280000, createdAt: 0 },
    ];
    const aggregated = aggregateDeductions(salaries);
    expect(aggregated).toEqual([
      { label: "健康保険料", total: 35000, count: 2 },
      { label: "厚生年金保険料", total: 32000, count: 1 },
    ]);
  });

  it("returns an empty array when no salaries have itemized deductions", () => {
    expect(aggregateDeductions([{ month: "2026-05", payday: 25, amount: 280000, createdAt: 0 }])).toEqual([]);
  });
});
