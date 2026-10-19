import { describe, expect, it } from "vitest";
import type { FixedCost, SubscriptionDetail } from "../types";
import { isFixedExpense, periodChargeSplit, salarySplit, sortByPayDay, splitFixedExpenses } from "./fixedCosts";
import type { SubscriptionItem } from "./subscriptions";

function item(title: string, over: Partial<FixedCost> = {}, detail?: Partial<SubscriptionDetail>): SubscriptionItem {
  return {
    cost: { id: title, title, category: "動画", amount: 1000, dueDay: 1, active: true, ...over },
    detail: detail ? { fixedCostId: title, cycle: "monthly", createdAt: 0, ...detail } : undefined,
  };
}

describe("固定費とサブスクの分け方(種類で決める)", () => {
  it("家賃・光熱費・通信費・保険などは固定費、動画・音楽などはサブスク", () => {
    expect(isFixedExpense({ category: "家賃" })).toBe(true);
    expect(isFixedExpense({ category: "水道光熱費" })).toBe(true);
    expect(isFixedExpense({ category: "その他の固定費" })).toBe(true);
    expect(isFixedExpense({ category: "動画" })).toBe(false);
    expect(isFixedExpense({ category: "その他" })).toBe(false);
    const { fixed, subscriptions } = splitFixedExpenses([item("家賃", { category: "家賃" }), item("Netflix")]);
    expect(fixed.map((i) => i.cost.title)).toEqual(["家賃"]);
    expect(subscriptions.map((i) => i.cost.title)).toEqual(["Netflix"]);
  });
});

describe("給料の期間に引く額を、固定費とサブスクに分ける(periodChargeSplit)", () => {
  it("毎月のものは1期に1回、年に1回のものは支払日が期の中の時だけ。止めたものは数えない", () => {
    const items = [
      item("家賃", { category: "家賃", amount: 70000, dueDay: 27 }),
      item("電気", { category: "水道光熱費", amount: 8000, dueDay: 5 }),
      item("自動車保険", { category: "保険", amount: 36000, dueDay: 10 }, { cycle: "yearly", billingMonth: 11 }),
      item("火災保険", { category: "保険", amount: 12000, dueDay: 1 }, { cycle: "yearly", billingMonth: 4 }),
      item("やめたジム", { category: "その他の固定費", amount: 9000, active: false }),
      item("Netflix", { amount: 1590 }),
    ];
    expect(periodChargeSplit(items, "2026-10-25", "2026-11-24")).toEqual({ fixed: 70000 + 8000 + 36000, subscriptions: 1590 });
  });
});

describe("固定費の並び(sortByPayDay)", () => {
  it("毎月のものを支払日の順、そのあと年に1回のものを月・日の順", () => {
    const sorted = sortByPayDay([
      item("家賃", { category: "家賃", dueDay: 27 }),
      item("年1回", { category: "保険", dueDay: 1 }, { cycle: "yearly", billingMonth: 3 }),
      item("電気", { category: "水道光熱費", dueDay: 5 }),
    ]);
    expect(sorted.map((i) => i.cost.title)).toEqual(["電気", "家賃", "年1回"]);
  });
});

describe("給与からの引き方(salarySplit)", () => {
  it("給与 − 固定費 − サブスク − 使った額 ＝ 残り。帯の幅は給与に対する割合", () => {
    const split = salarySplit({ salary: 200000, fixed: 80000, subscriptions: 20000, spent: 50000 });
    expect(split.remaining).toBe(50000);
    expect(split.shares).toEqual({ fixed: 0.4, subscriptions: 0.1, spent: 0.25, remaining: 0.25 });
  });

  it("使い過ぎて給与を超えた時は、合計を1として帯を縮め、残りはマイナス", () => {
    const split = salarySplit({ salary: 100000, fixed: 80000, subscriptions: 20000, spent: 100000 });
    expect(split.remaining).toBe(-100000);
    expect(split.shares.fixed + split.shares.subscriptions + split.shares.spent).toBeCloseTo(1);
    expect(split.shares.remaining).toBe(0);
  });
});
