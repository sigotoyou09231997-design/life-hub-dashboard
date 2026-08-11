import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Transaction } from "../../types";
import { formatDisplayDate, toDateStr, todayStr } from "../../lib/date";
import { usePayPeriodBudget } from "../../hooks/usePayPeriodBudget";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { ProgressBar } from "../ui/ProgressBar";
import { Button } from "../ui/Button";
import { ListSkeleton } from "../ui/ListSkeleton";

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

interface Props {
  onAddSalary: () => void;
}

export function ExpenseSummary({ onAddSalary }: Props) {
  const { data, loading } = usePayPeriodBudget();
  const periodStartStr = data ? toDateStr(data.period.periodStart) : null;

  const periodTransactions = useLiveQuery<Transaction[]>(
    () =>
      periodStartStr
        ? db.transactions.where("date").between(periodStartStr, todayStr(), true, true).toArray()
        : Promise.resolve([]),
    [periodStartStr],
  );

  const expenses = (periodTransactions ?? []).filter((t) => t.type === "expense");
  const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = (periodTransactions ?? [])
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);

  const byCategory = new Map<string, number>();
  for (const t of expenses) {
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
  }
  const categoryBreakdown = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);

  const showSkeleton = useDelayedFlag(loading);
  if (loading) return showSkeleton ? <ListSkeleton rows={2} /> : null;

  if (!data) {
    return (
      <Card className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm text-slate-500">
          まだ給与が登録されていません。給料日と給与額を登録すると、今の残額や1日あたり使える金額が分かります。
        </p>
        <Button onClick={onAddSalary}>給与を登録する</Button>
      </Card>
    );
  }

  const { period, totalFixedCosts, actualSpending, remaining, perDayUsable } = data;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">現在の残額</p>
          {!period.hasSalaryForPeriod && <Badge tone="warning">今期の給与が未入力です</Badge>}
        </div>
        <p className={`mt-1 text-3xl font-bold ${remaining < 0 ? "text-danger" : "text-slate-900"}`}>
          {yen(remaining)}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-slate-400">1日あたり使える金額</p>
            <p className="mt-0.5 font-semibold text-slate-900">{yen(perDayUsable)}</p>
          </div>
          <div>
            <p className="text-slate-400">給料日まで残り</p>
            <p className="mt-0.5 font-semibold text-slate-900">{period.daysUntilNextPayday}日</p>
          </div>
          <div>
            <p className="text-slate-400">次の給料日</p>
            <p className="mt-0.5 font-semibold text-slate-900">{formatDisplayDate(toDateStr(period.nextPayday))}</p>
          </div>
          <div>
            <p className="text-slate-400">使用済み金額</p>
            <p className="mt-0.5 font-semibold text-slate-900">{yen(actualSpending)}</p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex justify-between text-sm">
          <div>
            <p className="text-slate-400">今回の給与</p>
            <p className="mt-0.5 font-semibold text-success">
              {period.hasSalaryForPeriod ? yen(period.salaryAmount) : "未入力"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-slate-400">固定費合計</p>
            <p className="mt-0.5 font-semibold text-slate-900">{yen(totalFixedCosts)}</p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex justify-between text-sm">
          <div>
            <p className="text-slate-400">今期の収入(記録分)</p>
            <p className="mt-0.5 font-semibold text-success">{yen(totalIncome)}</p>
          </div>
          <div className="text-right">
            <p className="text-slate-400">今期の支出(記録分)</p>
            <p className="mt-0.5 font-semibold text-slate-900">{yen(totalExpense)}</p>
          </div>
        </div>
      </Card>

      {categoryBreakdown.length > 0 && (
        <Card>
          <p className="mb-3 text-sm font-medium text-slate-600">カテゴリ別支出</p>
          <div className="space-y-3">
            {categoryBreakdown.map(([category, amount]) => (
              <div key={category}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-slate-600">{category}</span>
                  <span className="font-medium text-slate-900">{yen(amount)}</span>
                </div>
                <ProgressBar value={totalExpense > 0 ? (amount / totalExpense) * 100 : 0} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
