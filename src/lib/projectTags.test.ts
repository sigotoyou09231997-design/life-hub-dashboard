import { describe, expect, it } from "vitest";
import type { Transaction, TransactionProjectTag } from "../types";
import {
  PROJECT_CSV_HEADER,
  buildProjectCsv,
  knownProjectTags,
  projectCsvFilename,
  summarizeProjectYear,
  tagsByTransactionId,
  yearsWithProjectRecords,
} from "./projectTags";

function tx(id: string, date: string, amount: number, type: Transaction["type"] = "expense"): Transaction {
  return { id, type, amount, category: "その他", date, isFixed: false, createdAt: 0 };
}

function tagRow(transactionId: string, tag: string): TransactionProjectTag {
  return { id: `t-${transactionId}`, transactionId, tag, createdAt: 0 };
}

describe("tagsByTransactionId / knownProjectTags", () => {
  const rows = [tagRow("a", "Aサイト制作"), tagRow("b", "Bアプリ"), tagRow("c", "Aサイト制作")];

  it("収支idで引ける表にする", () => {
    const map = tagsByTransactionId(rows);
    expect(map.get("a")).toBe("Aサイト制作");
    expect(map.get("z")).toBeUndefined();
  });

  it("使ったタグを重複なく並べる", () => {
    expect(knownProjectTags(rows)).toEqual(["Aサイト制作", "Bアプリ"]);
  });

  it("空白だけのタグは候補に出さない", () => {
    expect(knownProjectTags([tagRow("a", "   "), tagRow("b", "Bアプリ")])).toEqual(["Bアプリ"]);
  });
});

describe("summarizeProjectYear", () => {
  const transactions = [
    tx("a", "2026-04-10", 100_000, "income"),
    tx("b", "2026-04-20", 30_000),
    tx("c", "2026-05-01", 50_000, "income"),
    tx("d", "2026-05-02", 8_000),
    // 別の案件
    tx("e", "2026-04-15", 20_000, "income"),
    // タグの付いていない収支(家計の支出)
    tx("f", "2026-04-16", 900),
    // 前の年
    tx("g", "2025-12-31", 70_000, "income"),
  ];
  const tags = tagsByTransactionId([
    tagRow("a", "Aサイト制作"),
    tagRow("b", "Aサイト制作"),
    tagRow("c", "Aサイト制作"),
    tagRow("d", "Aサイト制作"),
    tagRow("e", "Bアプリ"),
    tagRow("g", "Aサイト制作"),
  ]);

  it("暦年で、案件別→月別にまとめる", () => {
    const summaries = summarizeProjectYear(transactions, tags, 2026);
    expect(summaries.map((s) => s.tag)).toEqual(["Aサイト制作", "Bアプリ"]);

    const a = summaries[0];
    expect(a.months).toEqual([
      { month: 4, income: 100_000, expense: 30_000, net: 70_000 },
      { month: 5, income: 50_000, expense: 8_000, net: 42_000 },
    ]);
    expect(a).toMatchObject({ income: 150_000, expense: 38_000, net: 112_000 });
  });

  it("タグの付いていない収支は入らない", () => {
    const summaries = summarizeProjectYear(transactions, tags, 2026);
    const total = summaries.reduce((sum, s) => sum + s.expense, 0);
    // 900円の家計の支出は入っていない。
    expect(total).toBe(38_000);
  });

  it("指定した年の外は入らない", () => {
    const summaries = summarizeProjectYear(transactions, tags, 2025);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ tag: "Aサイト制作", income: 70_000, expense: 0 });
  });

  it("記録が無ければ空", () => {
    expect(summarizeProjectYear(transactions, tags, 2020)).toEqual([]);
    expect(summarizeProjectYear([], new Map(), 2026)).toEqual([]);
  });

  it("記録のある月だけを、1月から順に並べる", () => {
    const summaries = summarizeProjectYear(
      [tx("x", "2026-09-01", 1000), tx("y", "2026-02-01", 2000)],
      tagsByTransactionId([tagRow("x", "P"), tagRow("y", "P")]),
      2026,
    );
    expect(summaries[0].months.map((m) => m.month)).toEqual([2, 9]);
  });
});

describe("buildProjectCsv", () => {
  const summaries = summarizeProjectYear(
    [
      tx("a", "2026-04-10", 100_000, "income"),
      tx("b", "2026-04-20", 30_000),
      tx("c", "2026-05-01", 20_000, "income"),
    ],
    tagsByTransactionId([tagRow("a", "Aサイト制作"), tagRow("b", "Aサイト制作"), tagRow("c", "Bアプリ")]),
    2026,
  );

  it("案件ごとに月を並べ、合計の行を挟む", () => {
    const lines = buildProjectCsv(summaries).split("\r\n");
    expect(lines[0]).toBe(PROJECT_CSV_HEADER.join(","));
    expect(lines[1]).toBe("Aサイト制作,4月,100000,30000,70000");
    expect(lines[2]).toBe("Aサイト制作,合計,100000,30000,70000");
    expect(lines[3]).toBe("Bアプリ,5月,20000,0,20000");
    expect(lines[4]).toBe("Bアプリ,合計,20000,0,20000");
    expect(lines[5]).toBe("全案件,合計,120000,30000,90000");
  });

  it("カンマを含む案件名は引用符で囲む(RFC 4180)", () => {
    const withComma = summarizeProjectYear(
      [tx("a", "2026-04-10", 1000, "income")],
      tagsByTransactionId([tagRow("a", "A社, B支店")]),
      2026,
    );
    expect(buildProjectCsv(withComma)).toContain('"A社, B支店"');
  });

  it("1件も無ければ見出しだけ(全案件の行も出さない)", () => {
    expect(buildProjectCsv([])).toBe(PROJECT_CSV_HEADER.join(","));
  });
});

describe("yearsWithProjectRecords", () => {
  it("タグの付いた収支のある年だけ、新しい順で返す", () => {
    const transactions = [tx("a", "2026-04-10", 1), tx("b", "2024-01-05", 1), tx("c", "2025-06-01", 1)];
    const tags = tagsByTransactionId([tagRow("a", "P"), tagRow("b", "P")]);
    expect(yearsWithProjectRecords(transactions, tags)).toEqual([2026, 2024]);
  });

  it("1件も無ければ空", () => {
    expect(yearsWithProjectRecords([tx("a", "2026-04-10", 1)], new Map())).toEqual([]);
  });
});

describe("projectCsvFilename", () => {
  it("年をファイル名に入れる", () => {
    expect(projectCsvFilename(2026)).toBe("life-hub-projects-2026.csv");
  });
});
