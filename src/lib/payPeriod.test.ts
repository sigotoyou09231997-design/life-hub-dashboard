import { describe, expect, it } from "vitest";
import {
  clampToMonth,
  currentPeriodStart,
  nextPeriodStart,
  resolveCurrentPeriod,
  calculatePayPeriodBudget,
} from "./payPeriod";
import type { SalaryEntry } from "../types";

describe("clampToMonth", () => {
  it("keeps the day as-is when the month has enough days", () => {
    expect(clampToMonth(2026, 0, 15)).toEqual(new Date(2026, 0, 15));
  });

  it("clamps payday 31 to the last day of a 30-day month", () => {
    expect(clampToMonth(2026, 3, 31)).toEqual(new Date(2026, 3, 30)); // April
  });

  it("clamps payday 29/31 to Feb 28 in a non-leap year", () => {
    expect(clampToMonth(2026, 1, 29)).toEqual(new Date(2026, 1, 28));
    expect(clampToMonth(2026, 1, 31)).toEqual(new Date(2026, 1, 28));
  });

  it("allows Feb 29 in a leap year", () => {
    expect(clampToMonth(2028, 1, 29)).toEqual(new Date(2028, 1, 29));
  });
});

describe("currentPeriodStart", () => {
  it("stays in the current month once payday has passed", () => {
    expect(currentPeriodStart(25, new Date(2026, 7, 30))).toEqual(new Date(2026, 7, 25));
  });

  it("treats today-as-payday as the start of the new period, not the previous one", () => {
    expect(currentPeriodStart(25, new Date(2026, 7, 25))).toEqual(new Date(2026, 7, 25));
  });

  it("falls back to last month's (clamped) payday before this month's payday arrives", () => {
    expect(currentPeriodStart(25, new Date(2026, 7, 10))).toEqual(new Date(2026, 6, 25));
  });

  it("cascades month-end clamping across the year boundary", () => {
    // payday 31, mid-April: this month's payday clamps to Apr 30, which is
    // still after Apr 15, so the period actually started on March 31.
    expect(currentPeriodStart(31, new Date(2026, 3, 15))).toEqual(new Date(2026, 2, 31));
  });
});

describe("nextPeriodStart", () => {
  it("advances to next month's payday", () => {
    expect(nextPeriodStart(25, new Date(2026, 7, 25))).toEqual(new Date(2026, 8, 25));
  });

  it("clamps the next occurrence when the following month is shorter", () => {
    // Period started March 31; next occurrence of "31" in April clamps to Apr 30.
    expect(nextPeriodStart(31, new Date(2026, 2, 31))).toEqual(new Date(2026, 3, 30));
  });
});

describe("resolveCurrentPeriod", () => {
  it("returns null when there is no salary history yet", () => {
    expect(resolveCurrentPeriod([], new Date(2026, 7, 10))).toBeNull();
  });

  it("uses the exact-month entry's amount when one exists for the current period", () => {
    const salaries: SalaryEntry[] = [
      { month: "2026-07", payday: 25, amount: 280000, createdAt: 0 },
      { month: "2026-08", payday: 25, amount: 300000, createdAt: 0 },
    ];
    const period = resolveCurrentPeriod(salaries, new Date(2026, 7, 30));
    expect(period).toMatchObject({
      periodStartMonth: "2026-08",
      salaryAmount: 300000,
      hasSalaryForPeriod: true,
      daysUntilNextPayday: 26, // Aug 30 -> Sep 25
    });
  });

  it("treats an unentered period as 0/unset without losing the payday pattern", () => {
    const salaries: SalaryEntry[] = [{ month: "2026-07", payday: 25, amount: 280000, createdAt: 0 }];
    const period = resolveCurrentPeriod(salaries, new Date(2026, 7, 30));
    expect(period).toMatchObject({
      payday: 25,
      periodStartMonth: "2026-08",
      salaryAmount: 0,
      hasSalaryForPeriod: false,
    });
  });
});

describe("calculatePayPeriodBudget", () => {
  it("subtracts fixed costs and actual spending from the salary", () => {
    const result = calculatePayPeriodBudget({
      salaryAmount: 300000,
      totalFixedCosts: 120000,
      actualSpending: 40000,
      daysUntilNextPayday: 20,
    });
    expect(result.remaining).toBe(140000);
    expect(result.perDayUsable).toBe(7000);
  });

  it("avoids dividing by zero when no days remain", () => {
    const result = calculatePayPeriodBudget({
      salaryAmount: 300000,
      totalFixedCosts: 120000,
      actualSpending: 40000,
      daysUntilNextPayday: 0,
    });
    expect(result.perDayUsable).toBe(result.remaining);
  });
});
