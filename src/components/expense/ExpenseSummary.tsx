import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Transaction } from "../../types";
import { formatDisplayDate, toDateStr, todayStr } from "../../lib/date";
import { calculateSavingsGoalProgress } from "../../lib/savingsGoal";
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

function BalanceTrend({ expenses }: { expenses: Transaction[] }) {
  const sorted = [...expenses].sort((a, b) => a.date.localeCompare(b.date));
  const values = [0];
  for (const transaction of sorted) values.push(values[values.length - 1] + transaction.amount);
  while (values.length < 5) values.push(values[values.length - 1] ?? 0);
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 38 - (value / max) * 30;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg viewBox="0 0 100 42" preserveAspectRatio="none" className="h-24 w-full overflow-visible" aria-label="今期の支出推移">
      <defs>
        <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6178ff" stopOpacity=".28" />
          <stop offset="100%" stopColor="#6178ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,42 ${points} 100,42`} fill="url(#balance-fill)" />
      <polyline className="chart-line" pathLength="1" points={points} fill="none" stroke="#6178ff" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface Props {
  onAddSalary: () => void;
}

export function ExpenseSummary({ onAddSalary }: Props) {
  const { data, loading } = usePayPeriodBudget();
  const periodStartStr = data ? toDateStr(data.period.periodStart) : null;
  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);

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
    // 給与未登録のときはこのカード1枚しか出ない。左上に寄せたまま画面の大半を
    // 背景のまま残さないよう、中央に置いて下まで伸ばす(.is-empty-fill、index.css)。
    return (
      <div className="finance-empty is-empty-fill mx-auto max-w-4xl">
        <Card className="finance-balance-module flex flex-col p-6 lg:p-8">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">使えるお金</p>
            <p className="mt-4 text-4xl font-medium tabular-nums tracking-[-0.05em] text-navy lg:text-6xl">¥ ---</p>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-600">給与を登録すると、今月使える金額を自動計算します。</p>
          </div>
          <Button className="mt-6 w-fit" onClick={onAddSalary}>給与を登録する</Button>
        </Card>
      </div>
    );
  }

  const { period, totalFixedCosts, actualSpending, remaining, perDayUsable } = data;

  // 目標が未設定(0)なら null が返り、この節ごと出さない — 貯金を強制しない。
  const savingsGoal = calculateSavingsGoalProgress(settings?.savingsGoalMonthly ?? 0, remaining);

  const recentTransactions = [...(periodTransactions ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  return (
    <div className="finance-control-center grid grid-cols-2 gap-3 lg:grid-cols-12">
      <Card className="finance-balance-module col-span-2 flex flex-col p-5 lg:col-span-7 lg:min-h-[280px] lg:p-7">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {/* 見出しは折り返させない — 2行に割れると、右のバッジと視覚的に絡まって
                どちらが何の情報か読み取れなくなる(スマホ幅で発生していた)。 */}
            <p className="whitespace-nowrap text-[11px] font-semibold tracking-[0.08em] text-slate-500">使えるお金</p>
            <p key={remaining} className={`value-change mt-3 text-4xl font-medium tabular-nums tracking-[-0.05em] lg:text-6xl ${remaining < 0 ? "text-danger" : "text-navy"}`}>{yen(remaining)}</p>
          </div>
          {!period.hasSalaryForPeriod && (
            <span className="shrink-0"><Badge tone="warning">給与が未入力</Badge></span>
          )}
        </div>
        <div className="mt-auto pt-6"><BalanceTrend expenses={expenses} /></div>
        <div className="mt-2 flex items-center justify-between border-t border-white/35 pt-3 text-xs text-slate-500">
          <span>{formatDisplayDate(toDateStr(period.periodStart))}から</span>
          <span>使用済み {yen(actualSpending)}</span>
        </div>
      </Card>

      <Card className="finance-summary-module col-span-2 p-5 lg:col-span-5 lg:p-7">
        <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">今期のまとめ</p>
        <div className="mt-5 divide-y divide-white/35">
          {[
            ["今回の給与", period.hasSalaryForPeriod ? yen(period.salaryAmount) : "未入力"],
            ["固定費合計", yen(totalFixedCosts)],
            ["記録した収入", yen(totalIncome)],
            ["記録した支出", yen(totalExpense)],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between py-3 text-sm"><span className="text-slate-500">{label}</span><span key={value} className="value-change font-semibold tabular-nums text-slate-800">{value}</span></div>
          ))}
        </div>
      </Card>

      {savingsGoal && (
        <Card className="finance-savings-module col-span-2 p-5 lg:col-span-12 lg:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">貯金目標</p>
            <span className="text-xs text-slate-500">目標 {yen(savingsGoal.goal)} / 月</span>
          </div>
          <p className="mt-3 mb-3 text-2xl font-medium tabular-nums tracking-[-0.03em] text-slate-800 lg:text-3xl">
            {yen(savingsGoal.projected)}
          </p>
          <ProgressBar value={savingsGoal.ratio} colorClass={savingsGoal.onTrack ? "bg-success" : "bg-accent"} />
          <p className="mt-2 text-xs text-slate-500">
            {savingsGoal.onTrack
              ? `このままなら目標より ${yen(savingsGoal.surplus)} 多く残せそうです`
              : `目標まであと ${yen(savingsGoal.shortfall)}`}
          </p>
        </Card>
      )}

      {[
        ["1日あたり使える金額", yen(perDayUsable)],
        ["給料日まで", `${period.daysUntilNextPayday}日`],
        ["次の給料日", formatDisplayDate(toDateStr(period.nextPayday))],
      ].map(([label, value]) => (
        <Card key={label} className="finance-metric-module p-4 lg:col-span-3 lg:p-5">
          <p className="truncate text-xs text-slate-500">{label}</p>
          <p key={value} className="value-change mt-2 text-xl font-semibold tabular-nums text-slate-800">{value}</p>
        </Card>
      ))}

      <Card className="finance-metric-module finance-metric-module--pace p-4 lg:col-span-3 lg:p-5">
        <p className="text-xs text-slate-500">利用ペース</p>
        <p className="mt-2 text-xl font-semibold tabular-nums text-slate-800">{period.daysUntilNextPayday > 0 ? yen(actualSpending / Math.max(1, expenses.length)) : yen(0)}</p>
        <p className="mt-1 text-[11px] text-slate-400">1支出あたりの平均</p>
      </Card>

      <Card className="finance-breakdown-module col-span-2 p-5 lg:col-span-6 lg:p-6">
        <p className="mb-4 text-sm font-semibold text-slate-700">カテゴリ別支出</p>
        {categoryBreakdown.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">今期の支出記録はありません</p>
        ) : (
          <div className="space-y-3">
            {categoryBreakdown.slice(0, 6).map(([category, amount]) => (
              <div key={category}>
                <div className="mb-1.5 flex justify-between text-xs"><span className="text-slate-600">{category}</span><span className="font-semibold tabular-nums text-slate-800">{yen(amount)}</span></div>
                <ProgressBar value={totalExpense > 0 ? (amount / totalExpense) * 100 : 0} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="finance-history-module col-span-2 p-5 lg:col-span-6 lg:p-6">
        <p className="mb-4 text-sm font-semibold text-slate-700">最近の履歴</p>
        {recentTransactions.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">履歴はありません</p>
        ) : (
          <div className="divide-y divide-white/35">
            {recentTransactions.map((transaction) => (
              <div key={transaction.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <div className="min-w-0"><p className="truncate font-medium text-slate-700">{transaction.category}</p><p className="text-[11px] text-slate-500">{formatDisplayDate(transaction.date)}</p></div>
                <span className={`shrink-0 font-semibold tabular-nums ${transaction.type === "income" ? "text-success" : "text-slate-800"}`}>{transaction.type === "income" ? "+" : "−"}{yen(transaction.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
