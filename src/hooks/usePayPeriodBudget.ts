import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import { resolveCurrentPeriod, calculatePayPeriodBudget, type CurrentPayPeriod } from "../lib/payPeriod";
import { toDateStr, todayStr } from "../lib/date";

export interface PayPeriodBudget {
  period: CurrentPayPeriod;
  totalFixedCosts: number;
  actualSpending: number;
  remaining: number;
  perDayUsable: number;
}

export function usePayPeriodBudget(): { data: PayPeriodBudget | null; loading: boolean } {
  const result = useLiveQuery(async () => {
    const [salaries, allFixedCosts] = await Promise.all([
      db.salaries.toArray(),
      db.fixedCosts.toArray(),
    ]);

    const period = resolveCurrentPeriod(salaries, new Date());
    if (!period) return null;

    const today = todayStr();
    const periodStartStr = toDateStr(period.periodStart);
    const periodTransactions = await db.transactions
      .where("date")
      .between(periodStartStr, today, true, true)
      .toArray();

    const actualSpending = periodTransactions
      .filter((t) => t.type === "expense" && !t.isFixed)
      .reduce((sum, t) => sum + t.amount, 0);
    const totalFixedCosts = allFixedCosts
      .filter((f) => f.active)
      .reduce((sum, f) => sum + f.amount, 0);

    const { remaining, perDayUsable } = calculatePayPeriodBudget({
      salaryAmount: period.salaryAmount,
      totalFixedCosts,
      actualSpending,
      daysUntilNextPayday: period.daysUntilNextPayday,
    });

    return { period, totalFixedCosts, actualSpending, remaining, perDayUsable };
  }, []);

  return { data: result ?? null, loading: result === undefined };
}
