import { subDays } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import { resolveCurrentPeriod, calculatePayPeriodBudget, type CurrentPayPeriod } from "../lib/payPeriod";
import { toDateStr, todayStr } from "../lib/date";
import { unsettledTotal } from "../lib/pendingCardCharges";
import { sumBonusIncome } from "../lib/bonus";
import { pairSubscriptions } from "../lib/subscriptions";
import { periodChargeSplit } from "../lib/fixedCosts";

export interface PayPeriodBudget {
  period: CurrentPayPeriod;
  totalFixedCosts: number;
  /** totalFixedCosts の内訳: 家賃・光熱費などの固定費と、サブスク(src/lib/fixedCosts.ts)。 */
  fixedExpenseTotal: number;
  subscriptionTotal: number;
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
    const [salaries, allFixedCosts, subscriptionDetails, pendingCharges] = await Promise.all([
      db.salaries.toArray(),
      db.fixedCosts.toArray(),
      db.subscriptionDetails.toArray(),
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
    // 年払いは請求日がこの期に入るときだけ、無料体験中・開始予定のものは請求が
    // 始まってから数える(src/lib/subscriptions.ts の chargeInPeriod)。付け足しの無い
    // 固定費は、いままでどおり止めていなければ1期に1回ぶん。
    const periodEndStr = toDateStr(subDays(period.nextPayday, 1));
    const split = periodChargeSplit(pairSubscriptions(allFixedCosts, subscriptionDetails), periodStartStr, periodEndStr);
    const totalFixedCosts = split.fixed + split.subscriptions;

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

    return {
      period,
      totalFixedCosts,
      fixedExpenseTotal: split.fixed,
      subscriptionTotal: split.subscriptions,
      actualSpending,
      pendingCardSpending,
      bonusAmount,
      remaining,
      perDayUsable,
    };
  }, []);

  return { data: result ?? null, loading: result === undefined };
}
