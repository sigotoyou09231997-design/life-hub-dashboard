import { describe, expect, it } from "vitest";
import type { Transaction } from "../types";
import {
  buildTransactionCsv,
  csvCell,
  filterTransactionsForExport,
  transactionCsvFilename,
} from "./transactionCsv";

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1",
    type: "expense",
    amount: 1200,
    category: "食費",
    date: "2026-08-10",
    isFixed: false,
    createdAt: 1,
    ...overrides,
  };
}

describe("csvCell", () => {
  it("leaves plain text untouched", () => {
    expect(csvCell("カフェ")).toBe("カフェ");
  });

  it("quotes cells containing a comma, quote, or newline", () => {
    expect(csvCell("A,B")).toBe('"A,B"');
    expect(csvCell('彼は"うん"と言った')).toBe('"彼は""うん""と言った"');
    expect(csvCell("1行目\n2行目")).toBe('"1行目\n2行目"');
  });

  it("turns an absent value into an empty cell", () => {
    expect(csvCell(undefined)).toBe("");
  });
});

describe("filterTransactionsForExport", () => {
  const rows = [
    tx({ id: "b", date: "2026-08-20" }),
    tx({ id: "a", date: "2026-08-01" }),
    tx({ id: "c", date: "2026-09-01" }),
  ];

  it("keeps only rows inside the range, both ends included", () => {
    const result = filterTransactionsForExport(rows, "2026-08-01", "2026-08-20");
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("sorts oldest first", () => {
    const result = filterTransactionsForExport(rows, "", "");
    expect(result.map((r) => r.date)).toEqual(["2026-08-01", "2026-08-20", "2026-09-01"]);
  });

  it("treats an empty end of the range as unbounded", () => {
    expect(filterTransactionsForExport(rows, "2026-08-15", "")).toHaveLength(2);
    expect(filterTransactionsForExport(rows, "", "2026-08-15")).toHaveLength(1);
  });
});

describe("buildTransactionCsv", () => {
  it("writes a header row followed by one CRLF-separated row per transaction", () => {
    const csv = buildTransactionCsv([tx(), tx({ id: "t2", type: "income", amount: 300000, category: "給与" })]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("日付,種別,カテゴリ,金額,支払い方法,店名,メモ,固定費");
    expect(lines[1]).toBe("2026-08-10,支出,食費,1200,,,,いいえ");
    expect(lines[2]).toBe("2026-08-10,収入,給与,300000,,,,いいえ");
  });

  it("fills in the optional columns and the fixed-cost flag when present", () => {
    const csv = buildTransactionCsv([
      tx({ method: "PayPay", store: "カフェA", memo: "打ち合わせ", isFixed: true }),
    ]);
    expect(csv.split("\r\n")[1]).toBe("2026-08-10,支出,食費,1200,PayPay,カフェA,打ち合わせ,はい");
  });

  it("quotes a store name that contains a comma so the columns don't shift", () => {
    const csv = buildTransactionCsv([tx({ store: "A,B商店" })]);
    expect(csv.split("\r\n")[1]).toContain('"A,B商店"');
  });

  it("rounds fractional amounts to whole yen", () => {
    const csv = buildTransactionCsv([tx({ amount: 1200.6 })]);
    expect(csv.split("\r\n")[1]).toContain(",1201,");
  });

  it("still emits the header when there is nothing to write", () => {
    expect(buildTransactionCsv([])).toBe("日付,種別,カテゴリ,金額,支払い方法,店名,メモ,固定費");
  });
});

describe("transactionCsvFilename", () => {
  it("names the file after the exported range", () => {
    expect(transactionCsvFilename("2026-08-01", "2026-08-31")).toBe(
      "life-hub-transactions-2026-08-01_2026-08-31.csv",
    );
  });
});
