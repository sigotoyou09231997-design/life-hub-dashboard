import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import { calculateBudget, type BudgetResult } from "../lib/budget";
import { monthRange, todayStr, daysLeftInMonth, daysElapsedInMonth } from "../lib/date";

export function useBudget(): { budget: BudgetResult; loading: boolean } {
  const data = useLiveQuery(async () => {
    const { start, end } = monthRange();
    const today = todayStr();

    const [settings, allFixedCosts, monthTransactions] = await Promise.all([
      db.settings.toCollection().first(),
      db.fixedCosts.toArray(),
      db.transactions.where("date").between(start, end, true, true).toArray(),
    ]);

    const variableExpenses = monthTransactions.filter((t) => t.type === "expense" && !t.isFixed);
    const variableExpensesThisMonth = variableExpenses.reduce((sum, t) => sum + t.amount, 0);
    const variableExpensesToday = variableExpenses
      .filter((t) => t.date === today)
      .reduce((sum, t) => sum + t.amount, 0);
    const totalFixedCosts = allFixedCosts
      .filter((f) => f.active)
      .reduce((sum, f) => sum + f.amount, 0);

    return calculateBudget({
      monthlyIncome: settings?.monthlyIncome ?? 0,
      totalFixedCosts,
      savingsGoalMonthly: settings?.savingsGoalMonthly ?? 0,
      variableExpensesThisMonth,
      variableExpensesToday,
      daysElapsed: daysElapsedInMonth(),
      daysLeftIncludingToday: daysLeftInMonth(),
    });
  }, []);

  return {
    budget:
      data ?? {
        monthlyDisposable: 0,
        remainingThisMonth: 0,
        perDayBudget: 0,
        todayUsable: 0,
        monthEndForecast: 0,
        savingsAchievementRate: 0,
      },
    loading: data === undefined,
  };
}
