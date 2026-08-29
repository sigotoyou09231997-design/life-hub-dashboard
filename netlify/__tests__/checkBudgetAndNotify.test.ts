import { describe, expect, it } from "vitest";
import {
  buildBudgetOverPayload,
  calculateRemaining,
  jstTodayStr,
  resolveBudgetPeriod,
  shouldNotifyBudgetOver,
  type BudgetPeriod,
  type SalaryRow,
} from "../functions/checkBudgetAndNotify";

const SALARIES: SalaryRow[] = [
  { month: "2026-07", payday: 25, amount: 280000 },
  { month: "2026-08", payday: 25, amount: 300000 },
];

function period(overrides: Partial<BudgetPeriod> = {}): BudgetPeriod {
  return {
    periodStart: "2026-08-25",
    periodStartMonth: "2026-08",
    nextPayday: "2026-09-25",
    daysUntilNextPayday: 10,
    salaryAmount: 300000,
    hasSalaryForPeriod: true,
    ...overrides,
  };
}

describe("jstTodayStr", () => {
  it("reads the JST wall-clock date, not UTC's", () => {
    // 2026-08-29 16:30 UTC は JST では翌日の 01:30。
    expect(jstTodayStr(Date.parse("2026-08-29T16:30:00Z"))).toBe("2026-08-30");
    expect(jstTodayStr(Date.parse("2026-08-29T14:00:00Z"))).toBe("2026-08-29");
  });
});

describe("resolveBudgetPeriod", () => {
  it("returns null when there is no salary history at all", () => {
    expect(resolveBudgetPeriod([], "2026-08-29")).toBeNull();
  });

  it("starts the period at this month's payday once it has passed", () => {
    const result = resolveBudgetPeriod(SALARIES, "2026-08-29")!;
    expect(result.periodStart).toBe("2026-08-25");
    expect(result.periodStartMonth).toBe("2026-08");
    expect(result.salaryAmount).toBe(300000);
    expect(result.hasSalaryForPeriod).toBe(true);
  });

  it("falls back to last month's payday before this month's arrives", () => {
    const result = resolveBudgetPeriod(SALARIES, "2026-08-10")!;
    expect(result.periodStart).toBe("2026-07-25");
    expect(result.salaryAmount).toBe(280000);
  });

  it("counts the days left until the next payday", () => {
    const result = resolveBudgetPeriod(SALARIES, "2026-08-29")!;
    expect(result.nextPayday).toBe("2026-09-25");
    expect(result.daysUntilNextPayday).toBe(27);
  });

  it("clamps a 31st payday to the last day of a shorter month", () => {
    const result = resolveBudgetPeriod([{ month: "2026-02", payday: 31, amount: 250000 }], "2026-02-28")!;
    expect(result.periodStart).toBe("2026-02-28");
    expect(result.nextPayday).toBe("2026-03-31");
  });

  it("crosses the year boundary when the period started in December", () => {
    const result = resolveBudgetPeriod([{ month: "2026-12", payday: 25, amount: 250000 }], "2026-12-30")!;
    expect(result.periodStart).toBe("2026-12-25");
    expect(result.nextPayday).toBe("2027-01-25");
  });

  it("keeps the payday pattern but reports no salary for a period never entered", () => {
    const result = resolveBudgetPeriod([{ month: "2026-07", payday: 25, amount: 280000 }], "2026-08-29")!;
    expect(result.periodStart).toBe("2026-08-25");
    expect(result.hasSalaryForPeriod).toBe(false);
    expect(result.salaryAmount).toBe(0);
  });
});

describe("calculateRemaining", () => {
  it("subtracts fixed costs and recorded spending from the salary", () => {
    expect(calculateRemaining(300000, 120000, 50000)).toBe(130000);
  });
});

describe("shouldNotifyBudgetOver", () => {
  it("notifies once the remaining balance has gone negative", () => {
    expect(shouldNotifyBudgetOver(period(), -3200)).toBe(true);
  });

  it("stays quiet while there is money left", () => {
    expect(shouldNotifyBudgetOver(period(), 0)).toBe(false);
    expect(shouldNotifyBudgetOver(period(), 12000)).toBe(false);
  });

  it("stays quiet when this period's salary was never entered", () => {
    // 給与0円として計算すると残額は必ずマイナスになるので、ここで送ってはいけない。
    expect(shouldNotifyBudgetOver(period({ hasSalaryForPeriod: false, salaryAmount: 0 }), -300000)).toBe(false);
    expect(shouldNotifyBudgetOver(period({ salaryAmount: 0 }), -300000)).toBe(false);
  });
});

describe("buildBudgetOverPayload", () => {
  it("states how far over budget the user is and links to the money screen", () => {
    const payload = JSON.parse(buildBudgetOverPayload(-3200, 5));
    expect(payload.title).toBe("今期の予算を ¥3,200 超えています");
    expect(payload.body).toBe("次の給料日まであと5日です。");
    expect(payload.url).toBe("/records/expense");
  });

  it("words the payday line differently on the payday itself", () => {
    const payload = JSON.parse(buildBudgetOverPayload(-1000, 0));
    expect(payload.body).toBe("今日が次の給料日です。");
  });
});
