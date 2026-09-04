import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import { resolveCurrentPeriod, calculatePayPeriodBudget, type CurrentPayPeriod } from "../lib/payPeriod";
import { toDateStr, todayStr } from "../lib/date";
import { unsettledTotal } from "../lib/pendingCardCharges";
import { sumBonusIncome } from "../lib/bonus";

export interface PayPeriodBudget {
  period: CurrentPayPeriod;
  totalFixedCosts: number;
  actualSpending: number;
  /** カードで使ったが、まだ支出として記録されていないぶん(src/lib/pendingCardCharges.ts)。
   * actualSpending に足したうえで残額を出しているので、画面はこの内訳を出せばよい。 */
  pendingCardSpending: number;
  /** その期に入った賞与(src/lib/bonus.ts)。給与に足したうえで残額を出している。 */
  bonusAmount: number;
  remaining: number;
  perDayUsable: number;
}

export function usePayPeriodBudget(): { data: PayPeriodBudget | null; loading: boolean } {
  const result = useLiveQuery(async () => {
    const [salaries, allFixedCosts, pendingCharges] = await Promise.all([
      db.salaries.toArray(),
      db.fixedCosts.toArray(),
      db.pendingCardCharges.toArray(),
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
    // その期に入った賞与は給与に足す(src/lib/bonus.ts)。
    const bonusAmount = sumBonusIncome(periodTransactions);
    const totalFixedCosts = allFixedCosts
      .filter((f) => f.active)
      .reduce((sum, f) => sum + f.amount, 0);

    // カードで使ったが、まだ支出として記録されていないぶんも先に引く。
    // 突き合わせは期の中だけでなく全支出に対して行う — 利用日が期の中でも、
    // 支出として記録した日付が期の外に置かれていることがあるため。
    const allTransactions = await db.transactions.toArray();
    const pendingCardSpending = unsettledTotal(pendingCharges, allTransactions, periodStartStr);

    const { remaining, perDayUsable } = calculatePayPeriodBudget({
      salaryAmount: period.salaryAmount,
      bonusAmount,
      totalFixedCosts,
      actualSpending: actualSpending + pendingCardSpending,
      daysUntilNextPayday: period.daysUntilNextPayday,
    });

    return { period, totalFixedCosts, actualSpending, pendingCardSpending, bonusAmount, remaining, perDayUsable };
  }, []);

  return { data: result ?? null, loading: result === undefined };
}
