export interface BudgetInput {
  monthlyIncome: number;
  totalFixedCosts: number;
  savingsGoalMonthly: number;
  /** Sum of variable (non-fixed) expenses from day 1 through today, inclusive. */
  variableExpensesThisMonth: number;
  /** Sum of variable expenses dated today. */
  variableExpensesToday: number;
  /** Calendar day-of-month for today (e.g. 15 on the 15th). */
  daysElapsed: number;
  /** Days remaining in the month, counting today. */
  daysLeftIncludingToday: number;
}

export interface BudgetResult {
  monthlyDisposable: number;
  remainingThisMonth: number;
  perDayBudget: number;
  todayUsable: number;
  monthEndForecast: number;
  savingsAchievementRate: number;
}

export function calculateBudget(input: BudgetInput): BudgetResult {
  const monthlyDisposable =
    input.monthlyIncome - input.totalFixedCosts - input.savingsGoalMonthly;
  const remainingThisMonth = monthlyDisposable - input.variableExpensesThisMonth;
  const perDayBudget =
    input.daysLeftIncludingToday > 0
      ? remainingThisMonth / input.daysLeftIncludingToday
      : remainingThisMonth;
  const todayUsable = perDayBudget - input.variableExpensesToday;

  const avgDailySpendSoFar =
    input.daysElapsed > 0 ? input.variableExpensesThisMonth / input.daysElapsed : 0;
  // Today's actual spending is already reflected in remainingThisMonth, so the
  // pace-based projection only needs to cover the days strictly after today.
  const remainingDaysAfterToday = Math.max(input.daysLeftIncludingToday - 1, 0);
  const monthEndForecast =
    remainingThisMonth - avgDailySpendSoFar * remainingDaysAfterToday;

  const actualSavingsSoFar =
    input.monthlyIncome - input.totalFixedCosts - input.variableExpensesThisMonth;
  const savingsAchievementRate =
    input.savingsGoalMonthly > 0 ? actualSavingsSoFar / input.savingsGoalMonthly : 0;

  return {
    monthlyDisposable,
    remainingThisMonth,
    perDayBudget,
    todayUsable,
    monthEndForecast,
    savingsAchievementRate,
  };
}
