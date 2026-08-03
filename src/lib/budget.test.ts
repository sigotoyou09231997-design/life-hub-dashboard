import { describe, expect, it } from "vitest";
import { calculateBudget } from "./budget";

describe("calculateBudget", () => {
  it("splits the remaining monthly budget evenly across remaining days", () => {
    const result = calculateBudget({
      monthlyIncome: 300000,
      totalFixedCosts: 150000,
      savingsGoalMonthly: 30000,
      variableExpensesThisMonth: 20000,
      variableExpensesToday: 0,
      daysElapsed: 10,
      daysLeftIncludingToday: 21, // 31-day month, today is day 10
    });

    expect(result.monthlyDisposable).toBe(120000);
    expect(result.remainingThisMonth).toBe(100000);
    expect(result.perDayBudget).toBeCloseTo(100000 / 21);
    expect(result.todayUsable).toBeCloseTo(100000 / 21);
  });

  it("subtracts today's spending from today's usable amount only", () => {
    const result = calculateBudget({
      monthlyIncome: 300000,
      totalFixedCosts: 150000,
      savingsGoalMonthly: 30000,
      variableExpensesThisMonth: 20000,
      variableExpensesToday: 3000,
      daysElapsed: 10,
      daysLeftIncludingToday: 21,
    });

    expect(result.todayUsable).toBeCloseTo(100000 / 21 - 3000);
  });

  it("projects month-end balance using the average daily pace for days after today", () => {
    const result = calculateBudget({
      monthlyIncome: 300000,
      totalFixedCosts: 150000,
      savingsGoalMonthly: 0,
      variableExpensesThisMonth: 50000, // 5000/day over 10 days
      variableExpensesToday: 5000,
      daysElapsed: 10,
      daysLeftIncludingToday: 21,
    });

    // remainingThisMonth = 150000 - 50000 = 100000
    // avgDailySpend = 5000, remainingDaysAfterToday = 20
    expect(result.remainingThisMonth).toBe(100000);
    expect(result.monthEndForecast).toBeCloseTo(100000 - 5000 * 20);
  });

  it("returns a zero savings rate when no goal is set instead of dividing by zero", () => {
    const result = calculateBudget({
      monthlyIncome: 300000,
      totalFixedCosts: 150000,
      savingsGoalMonthly: 0,
      variableExpensesThisMonth: 20000,
      variableExpensesToday: 0,
      daysElapsed: 10,
      daysLeftIncludingToday: 21,
    });

    expect(result.savingsAchievementRate).toBe(0);
  });

  it("computes the savings achievement rate against the monthly goal", () => {
    const result = calculateBudget({
      monthlyIncome: 300000,
      totalFixedCosts: 150000,
      savingsGoalMonthly: 30000,
      variableExpensesThisMonth: 90000,
      variableExpensesToday: 0,
      daysElapsed: 30,
      daysLeftIncludingToday: 1,
    });

    // actual savings so far = 300000 - 150000 - 90000 = 60000
    expect(result.savingsAchievementRate).toBeCloseTo(60000 / 30000);
  });
});
