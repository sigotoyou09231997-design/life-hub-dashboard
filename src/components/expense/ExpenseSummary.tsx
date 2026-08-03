import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import { monthRange } from "../../lib/date";
import { useBudget } from "../../hooks/useBudget";
import { Card } from "../ui/Card";
import { ProgressBar } from "../ui/ProgressBar";

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

export function ExpenseSummary() {
  const { budget } = useBudget();
  const { start, end } = monthRange();

  const monthTransactions = useLiveQuery(
    () => db.transactions.where("date").between(start, end, true, true).toArray(),
    [start, end],
  );

  const expenses = (monthTransactions ?? []).filter((t) => t.type === "expense");
  const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = (monthTransactions ?? [])
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);

  const byCategory = new Map<string, number>();
  for (const t of expenses) {
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
  }
  const categoryBreakdown = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-slate-400">今月あと使える金額</p>
        <p
          className={`mt-1 text-3xl font-bold ${
            budget.remainingThisMonth < 0 ? "text-danger" : "text-slate-900"
          }`}
        >
          {yen(budget.remainingThisMonth)}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-slate-400">1日あたり使える金額</p>
            <p className="mt-0.5 font-semibold text-slate-900">{yen(budget.perDayBudget)}</p>
          </div>
          <div>
            <p className="text-slate-400">月末残金予測</p>
            <p
              className={`mt-0.5 font-semibold ${
                budget.monthEndForecast < 0 ? "text-danger" : "text-slate-900"
              }`}
            >
              {yen(budget.monthEndForecast)}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <p className="mb-2 text-sm text-slate-400">貯金目標達成率</p>
        <ProgressBar
          value={budget.savingsAchievementRate * 100}
          colorClass={budget.savingsAchievementRate >= 1 ? "bg-success" : "bg-accent"}
        />
        <p className="mt-1.5 text-xs text-slate-400">
          {Math.round(budget.savingsAchievementRate * 100)}% 達成
        </p>
      </Card>

      <Card>
        <div className="flex justify-between text-sm">
          <div>
            <p className="text-slate-400">今月の収入(記録分)</p>
            <p className="mt-0.5 font-semibold text-success">{yen(totalIncome)}</p>
          </div>
          <div className="text-right">
            <p className="text-slate-400">今月の支出(記録分)</p>
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
