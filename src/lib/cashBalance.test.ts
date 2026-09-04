import { describe, expect, it } from "vitest";
import { cashDelta, viewCashBalance } from "./cashBalance";
import type { Settings, Transaction } from "../types";

function tx(over: Partial<Transaction>): Transaction {
  return {
    type: "expense",
    amount: 0,
    category: "食費",
    date: "2026-09-04",
    isFixed: false,
    createdAt: 0,
    ...over,
  };
}

const settings: Settings = {
  monthlyIncome: 0,
  savingsGoalMonthly: 0,
  paypayBalance: 0,
  paypayBalanceUpdatedAt: 0,
  cashBalance: 10_000,
  cashBalanceUpdatedAt: 100,
  autoDraftEnabled: false,
};

describe("cashDelta", () => {
  it("起点より後の現金の支出を引き、収入を足す", () => {
    const rows = [
      tx({ method: "現金", amount: 800, createdAt: 200 }),
      tx({ method: "現金", amount: 3_000, type: "income", createdAt: 300 }),
    ];
    expect(cashDelta(rows, 100)).toEqual({ delta: 2_200, counted: 2 });
  });

  it("現金以外の支払い方法は数えない", () => {
    const rows = [
      tx({ method: "クレジットカード", amount: 5_000, createdAt: 200 }),
      tx({ method: "電子マネー", amount: 500, createdAt: 200 }),
      tx({ amount: 700, createdAt: 200 }), // 未指定
    ];
    expect(cashDelta(rows, 100)).toEqual({ delta: 0, counted: 0 });
  });

  it("起点より前・同時に記録したものは数えない(数えた額に既に入っているため)", () => {
    const rows = [
      tx({ method: "現金", amount: 900, createdAt: 50 }),
      tx({ method: "現金", amount: 900, createdAt: 100 }),
    ];
    expect(cashDelta(rows, 100)).toEqual({ delta: 0, counted: 0 });
  });
});

describe("viewCashBalance", () => {
  it("数えた額に、そのあとの現金の収支を足し引きする", () => {
    const view = viewCashBalance(settings, [tx({ method: "現金", amount: 1_200, createdAt: 500 })]);
    expect(view).toEqual({ estimated: 8_800, baseline: 10_000, anchor: 100, countedTransactions: 1 });
  });

  it("一度も入力していなければ0から始まる", () => {
    expect(viewCashBalance(undefined, [])).toEqual({
      estimated: 0,
      baseline: 0,
      anchor: 0,
      countedTransactions: 0,
    });
  });

  it("起点が未設定の端末では、記録済みの現金の収支をすべて足し引きする", () => {
    const old: Settings = { ...settings, cashBalance: undefined, cashBalanceUpdatedAt: undefined };
    const view = viewCashBalance(old, [tx({ method: "現金", amount: 300, createdAt: 1 })]);
    expect(view.estimated).toBe(-300);
  });
});
