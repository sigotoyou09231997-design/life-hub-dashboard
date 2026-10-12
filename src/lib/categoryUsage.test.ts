import { describe, expect, it } from "vitest";
import type { Transaction } from "../types";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "./categories";
import { orderCategoriesByUsage } from "./categoryUsage";

function tx(category: string, date: string, type: Transaction["type"] = "expense"): Transaction {
  return { type, amount: 100, category, date, isFixed: false, createdAt: 0 };
}

const TODAY = "2026-10-12";

describe("orderCategoriesByUsage", () => {
  it("記録が無ければ、元の並びのまま", () => {
    expect(orderCategoriesByUsage(EXPENSE_CATEGORIES, [], "expense", TODAY)).toEqual(EXPENSE_CATEGORIES);
  });

  it("直近でよく使った順に前へ出し、同じ回数・未使用は元の順を保つ", () => {
    const rows = [
      tx("交通費", "2026-10-10"),
      tx("交通費", "2026-10-01"),
      tx("交通費", "2026-09-20"),
      tx("日用品", "2026-10-11"),
      tx("美容", "2026-09-01"),
    ];
    expect(orderCategoriesByUsage(EXPENSE_CATEGORIES, rows, "expense", TODAY)).toEqual([
      "交通費",
      // 日用品と美容は1回ずつ — 元の順(日用品が先)
      "日用品",
      "美容",
      "食費",
      "娯楽",
      "交際費",
      "医療",
      "教育",
      "その他",
    ]);
  });

  it("90日より前の記録は数えない(季節で使うカテゴリが変わるため)", () => {
    const rows = [tx("医療", "2026-07-13"), tx("医療", "2026-07-12"), tx("医療", "2026-01-01"), tx("娯楽", "2026-10-01")];
    // 7/14 が90日前。7/13 以前は数えないので、娯楽だけが前に出る。
    expect(orderCategoriesByUsage(EXPENSE_CATEGORIES, rows, "expense", TODAY)[0]).toBe("娯楽");
    expect(orderCategoriesByUsage(EXPENSE_CATEGORIES, [tx("医療", "2026-07-14")], "expense", TODAY)[0]).toBe("医療");
  });

  it("支出と収入は分けて数える", () => {
    const rows = [tx("副業", "2026-10-01", "income"), tx("副業", "2026-10-02", "income"), tx("その他", "2026-10-03")];
    expect(orderCategoriesByUsage(INCOME_CATEGORIES, rows, "income", TODAY)[0]).toBe("副業");
    // 支出の「その他」は、収入の「その他」の回数に入らない
    expect(orderCategoriesByUsage(INCOME_CATEGORIES, rows, "income", TODAY).at(-1)).toBe("その他");
  });

  it("一覧に無いカテゴリはボタンに足さない", () => {
    const ordered = orderCategoriesByUsage(EXPENSE_CATEGORIES, [tx("ペット", "2026-10-01")], "expense", TODAY);
    expect(ordered).toEqual(EXPENSE_CATEGORIES);
  });
});
