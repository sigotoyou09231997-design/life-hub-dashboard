import { describe, expect, it } from "vitest";
import { BONUS_CATEGORY, isBonus, selectBonuses, sumBonusIncome } from "./bonus";
import { calculatePayPeriodBudget } from "./payPeriod";
import type { Transaction } from "../types";

function tx(over: Partial<Transaction>): Transaction {
  return {
    type: "income",
    amount: 100_000,
    category: BONUS_CATEGORY,
    date: "2026-07-10",
    isFixed: false,
    createdAt: 0,
    ...over,
  };
}

describe("isBonus", () => {
  it("収入かつカテゴリがボーナスのものだけ", () => {
    expect(isBonus(tx({}))).toBe(true);
    expect(isBonus(tx({ type: "expense" }))).toBe(false);
    expect(isBonus(tx({ category: "臨時収入" }))).toBe(false);
  });
});

describe("sumBonusIncome", () => {
  it("賞与だけを足す(給与や臨時収入は入れない)", () => {
    const rows = [
      tx({ amount: 300_000 }),
      tx({ amount: 50_000 }),
      tx({ amount: 250_000, category: "給与" }),
      tx({ amount: 10_000, category: "臨時収入" }),
      tx({ amount: 800, type: "expense", category: BONUS_CATEGORY }),
    ];
    expect(sumBonusIncome(rows)).toBe(350_000);
  });

  it("1件も無ければ0", () => {
    expect(sumBonusIncome([])).toBe(0);
  });
});

describe("selectBonuses", () => {
  it("新しい支給日が上", () => {
    const rows = [
      tx({ id: "a", date: "2026-07-10" }),
      tx({ id: "b", date: "2026-12-10" }),
      tx({ id: "c", date: "2026-07-10", createdAt: 5 }),
      tx({ id: "d", category: "給与" }),
    ];
    expect(selectBonuses(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
});

describe("残額への反映", () => {
  it("賞与は給与に足されて使えるお金が増える", () => {
    const base = { salaryAmount: 300_000, totalFixedCosts: 100_000, actualSpending: 50_000, daysUntilNextPayday: 10 };
    expect(calculatePayPeriodBudget(base).remaining).toBe(150_000);
    expect(calculatePayPeriodBudget({ ...base, bonusAmount: 400_000 }).remaining).toBe(550_000);
  });

  it("賞与を渡さない呼び出しは今までどおり", () => {
    expect(
      calculatePayPeriodBudget({
        salaryAmount: 200_000,
        totalFixedCosts: 0,
        actualSpending: 0,
        daysUntilNextPayday: 4,
      }),
    ).toEqual({ remaining: 200_000, perDayUsable: 50_000 });
  });
});
