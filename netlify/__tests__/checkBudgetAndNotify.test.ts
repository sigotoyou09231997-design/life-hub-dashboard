import { describe, expect, it } from "vitest";
import {
  buildBudgetForecastPayload,
  buildBudgetOverPayload,
  calculateRemaining,
  forecastOverCategories,
  FORECAST_MIN_ELAPSED_DAYS,
  jstTodayStr,
  resolveBudgetPeriod,
  shouldNotifyBudgetOver,
  type BudgetPeriod,
  type CategoryBudgetRow,
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

describe("forecastOverCategories", () => {
  const BUDGETS: CategoryBudgetRow[] = [{ category: "食費", monthly_amount: 30000 }];
  const spent = (amount: number, category = "食費") => new Map([[category, amount]]);

  it("flags a category whose pace projects past the limit before the next payday", () => {
    // 10日で15,000円 → 1日1,500円 → 30日で45,000円。上限30,000円を15,000円超える見込み。
    const [forecast] = forecastOverCategories(BUDGETS, spent(15_000), 10, 20);
    expect(forecast.projected).toBe(45_000);
    expect(forecast.projectedOver).toBe(15_000);
  });

  it("stays quiet when the pace lands inside the limit", () => {
    expect(forecastOverCategories(BUDGETS, spent(8_000), 10, 20)).toEqual([]);
  });

  it("leaves categories that already went over to the 'over budget' notification", () => {
    expect(forecastOverCategories(BUDGETS, spent(31_000), 10, 20)).toEqual([]);
  });

  it("waits until enough of the period has passed to judge a pace", () => {
    expect(forecastOverCategories(BUDGETS, spent(15_000), FORECAST_MIN_ELAPSED_DAYS - 1, 28)).toEqual([]);
    expect(forecastOverCategories(BUDGETS, spent(15_000), FORECAST_MIN_ELAPSED_DAYS, 28)).toHaveLength(1);
  });

  it("says nothing on the payday itself, when there is nothing left to forecast", () => {
    expect(forecastOverCategories(BUDGETS, spent(15_000), 30, 0)).toEqual([]);
  });

  it("skips rows with no real limit set", () => {
    expect(forecastOverCategories([{ category: "食費", monthly_amount: 0 }], spent(5_000), 10, 20)).toEqual([]);
  });

  it("treats a category with no spending yet as fine", () => {
    expect(forecastOverCategories(BUDGETS, new Map(), 10, 20)).toEqual([]);
  });

  it("puts the biggest overshoot first", () => {
    const budgets: CategoryBudgetRow[] = [
      { category: "食費", monthly_amount: 30000 },
      { category: "交際費", monthly_amount: 10000 },
    ];
    const result = forecastOverCategories(
      budgets,
      new Map([
        ["食費", 15_000], // 見込み 45,000 → 15,000 超過
        ["交際費", 8_000], // 見込み 24,000 → 14,000 超過
      ]),
      10,
      20,
    );
    expect(result.map((f) => f.category)).toEqual(["食費", "交際費"]);
  });
});

describe("buildBudgetForecastPayload", () => {
  const FOOD = { category: "食費", budget: 30000, spent: 15000, projected: 45000, projectedOver: 15000 };

  it("names the category and shows the projection against the limit", () => {
    const payload = JSON.parse(buildBudgetForecastPayload([FOOD], 20));
    expect(payload.title).toBe("このペースだと 食費 が給料日までに超えそうです");
    expect(payload.body).toBe("食費は ¥45,000 の見込み(予算 ¥30,000)。次の給料日まであと20日です。");
    expect(payload.url).toBe("/records/expense");
  });

  it("counts the rest rather than listing every category", () => {
    const other = { category: "交際費", budget: 10000, spent: 8000, projected: 24000, projectedOver: 14000 };
    const payload = JSON.parse(buildBudgetForecastPayload([FOOD, other], 5));
    expect(payload.title).toBe("このペースだと 食費・ほか1件 が給料日までに超えそうです");
  });
});
