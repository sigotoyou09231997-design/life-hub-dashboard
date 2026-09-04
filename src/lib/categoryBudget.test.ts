import { describe, expect, it } from "vitest";
import { FORECAST_MIN_ELAPSED_DAYS, forecastFor, forecastOverBudget, statusFor } from "./categoryBudget";

describe("forecastFor", () => {
  const budget = { category: "食費", monthlyAmount: 30_000, createdAt: 0 };

  it("今のペースで期末まで使ったときの見込みを出す", () => {
    // 10日で15,000円 = 1日1,500円。30日で45,000円の見込み → 15,000円のはみ出し。
    const forecast = forecastFor(statusFor(budget, 15_000), 10, 20);
    expect(forecast.projected).toBe(45_000);
    expect(forecast.projectedOver).toBe(15_000);
    expect(forecast.willExceed).toBe(true);
  });

  it("見込みが上限に収まるなら知らせない", () => {
    // 10日で8,000円 = 30日で24,000円。上限30,000円に収まる。
    expect(forecastFor(statusFor(budget, 8_000), 10, 20).willExceed).toBe(false);
  });

  it("すでに超えているカテゴリは対象にしない(予測ではなく事実として別に出す)", () => {
    expect(forecastFor(statusFor(budget, 31_000), 10, 20).willExceed).toBe(false);
  });

  it("期の頭すぎるうちは予測しない", () => {
    const early = forecastFor(statusFor(budget, 15_000), FORECAST_MIN_ELAPSED_DAYS - 1, 28);
    expect(early.willExceed).toBe(false);
    expect(early.projected).toBe(15_000);
  });

  it("給料日当日(残り0日)は予測しない", () => {
    expect(forecastFor(statusFor(budget, 15_000), 30, 0).willExceed).toBe(false);
  });

  it("上限を決めていない行は対象にしない", () => {
    const noLimit = { category: "その他", monthlyAmount: 0, createdAt: 0 };
    expect(forecastFor(statusFor(noLimit, 5_000), 10, 20).willExceed).toBe(false);
  });
});

describe("forecastOverBudget", () => {
  it("超えそうなカテゴリだけを、はみ出しの大きい順に返す", () => {
    const statuses = [
      statusFor({ category: "食費", monthlyAmount: 30_000, createdAt: 0 }, 15_000), // 見込み45,000 → +15,000
      statusFor({ category: "趣味", monthlyAmount: 10_000, createdAt: 0 }, 4_000), // 見込み12,000 → +2,000
      statusFor({ category: "日用品", monthlyAmount: 20_000, createdAt: 0 }, 2_000), // 見込み6,000 → 収まる
    ];
    const forecasts = forecastOverBudget(statuses, 10, 20);
    expect(forecasts.map((f) => f.category)).toEqual(["食費", "趣味"]);
  });
});
import type { CategoryBudget, Transaction } from "../types";
import {
  NEAR_LIMIT_RATIO,
  overBudgetCategories,
  sortCategoryBudgets,
  spendingByCategory,
  summarizeCategoryBudgets,
  totalCategoryBudget,
  unbudgetedCategories,
} from "./categoryBudget";

function budget(category: string, monthlyAmount: number): CategoryBudget {
  return { id: category, category, monthlyAmount, createdAt: 0 };
}

function expense(category: string, amount: number, overrides: Partial<Transaction> = {}): Transaction {
  return { type: "expense", amount, category, date: "2026-08-30", isFixed: false, createdAt: 0, ...overrides };
}

describe("spendingByCategory", () => {
  it("カテゴリごとに支出を足す", () => {
    const map = spendingByCategory([expense("食費", 1200), expense("食費", 800), expense("交通費", 500)]);
    expect(map.get("食費")).toBe(2000);
    expect(map.get("交通費")).toBe(500);
  });

  it("収入は数えず、固定費として記録した支出は数える", () => {
    // サマリーの「カテゴリ別支出」と同じ数え方(同じcardの中で母数を揃える)。
    const map = spendingByCategory([
      expense("食費", 1000),
      expense("食費", 5000, { isFixed: true }),
      expense("給与", 200_000, { type: "income" }),
    ]);
    expect(map.get("食費")).toBe(6000);
    expect(map.has("給与")).toBe(false);
  });

  it("支出が無ければ空", () => {
    expect(spendingByCategory([]).size).toBe(0);
  });
});

describe("sortCategoryBudgets", () => {
  it("支出カテゴリの並び順に合わせる", () => {
    const sorted = sortCategoryBudgets([budget("交通費", 1), budget("食費", 1), budget("日用品", 1)]);
    expect(sorted.map((b) => b.category)).toEqual(["食費", "日用品", "交通費"]);
  });

  it("一覧に無いカテゴリは後ろへ回す", () => {
    const sorted = sortCategoryBudgets([budget("推し活", 1), budget("食費", 1)]);
    expect(sorted.map((b) => b.category)).toEqual(["食費", "推し活"]);
  });
});

describe("summarizeCategoryBudgets", () => {
  const spent = new Map([
    ["食費", 32_000],
    ["交通費", 8_500],
  ]);

  it("使った割合と残りを出す", () => {
    const [food] = summarizeCategoryBudgets([budget("食費", 40_000)], spent);
    expect(food).toMatchObject({ category: "食費", budget: 40_000, spent: 32_000, remaining: 8_000, over: false });
    expect(food.ratio).toBe(80);
  });

  it("超えたら over、残りはマイナス", () => {
    const [food] = summarizeCategoryBudgets([budget("食費", 30_000)], spent);
    expect(food.over).toBe(true);
    expect(food.remaining).toBe(-2_000);
    expect(food.nearLimit).toBe(false);
  });

  it("上限に近いと nearLimit(超えている間は立てない)", () => {
    expect(summarizeCategoryBudgets([budget("食費", 40_000)], spent)[0].nearLimit).toBe(true);
    expect(summarizeCategoryBudgets([budget("食費", 100_000)], spent)[0].nearLimit).toBe(false);
    expect(NEAR_LIMIT_RATIO).toBe(80);
  });

  it("使っていないカテゴリの予算も残す(0円として出す)", () => {
    const [beauty] = summarizeCategoryBudgets([budget("美容", 5_000)], spent);
    expect(beauty).toMatchObject({ spent: 0, ratio: 0, remaining: 5_000, over: false });
  });

  it("上限0円は未設定と同じなので落とす", () => {
    expect(summarizeCategoryBudgets([budget("食費", 0)], spent)).toEqual([]);
  });
});

describe("overBudgetCategories", () => {
  it("超えた額の大きい順に返す", () => {
    const statuses = summarizeCategoryBudgets(
      [budget("食費", 30_000), budget("交通費", 8_000), budget("娯楽", 10_000)],
      new Map([
        ["食費", 32_000],
        ["交通費", 8_500],
        ["娯楽", 1_000],
      ]),
    );
    expect(overBudgetCategories(statuses).map((s) => s.category)).toEqual(["食費", "交通費"]);
  });
});

describe("totalCategoryBudget / unbudgetedCategories", () => {
  it("上限の合計を出す", () => {
    expect(totalCategoryBudget([budget("食費", 30_000), budget("交通費", 8_000)])).toBe(38_000);
  });

  it("まだ予算を付けていないカテゴリを返す", () => {
    const rest = unbudgetedCategories([budget("食費", 1), budget("交通費", 1)]);
    expect(rest).not.toContain("食費");
    expect(rest).toContain("日用品");
  });
});
