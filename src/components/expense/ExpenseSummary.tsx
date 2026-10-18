import { Link, useNavigate } from "react-router-dom";
import { EmptyState } from "../ui/EmptyState";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Transaction } from "../../types";
import { formatDisplayDate, toDateStr, todayStr } from "../../lib/date";
import {
  forecastOverBudget,
  overBudgetCategories,
  spendingByCategory,
  summarizeCategoryBudgets,
} from "../../lib/categoryBudget";
import { payPeriodProgress } from "../../lib/payPeriod";
import { planSavingsGoals } from "../../lib/savingsGoal";
import { usePayPeriodBudget } from "../../hooks/usePayPeriodBudget";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { ProgressBar } from "../ui/ProgressBar";
import { Button } from "../ui/Button";
import { ListSkeleton } from "../ui/ListSkeleton";
import { CashBalanceCard } from "./CashBalanceCard";
import { CountingAmount } from "../ui/CountingAmount";

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
        {/* 線と面はお金管理のエリア色に従う（src/lib/areaColors.ts）。青を直書き
            していたので、暖色刷新でお金管理が紫になったあとも、このグラフだけ
            青いままだった。 */}
        <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity=".24" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,42 ${points} 100,42`} fill="url(#balance-fill)" />
      <polyline className="chart-line" pathLength="1" points={points} fill="none" stroke="var(--color-accent)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface Props {
  onAddSalary: () => void;
}

export function ExpenseSummary({ onAddSalary }: Props) {
  const navigate = useNavigate();
  const { data, loading } = usePayPeriodBudget();
  const periodStartStr = data ? toDateStr(data.period.periodStart) : null;
  const savingsGoals = useLiveQuery(() => db.savingsGoals.toArray(), []);
  const categoryBudgets = useLiveQuery(() => db.categoryBudgets.toArray(), []);

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

  const byCategory = spendingByCategory(expenses);
  const categoryBreakdown = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);

  // カテゴリ別の予算(設定画面で決める)。設定していなければ今までどおり、
  // 支出の内訳だけを出す。
  const budgetStatuses = summarizeCategoryBudgets(categoryBudgets ?? [], byCategory);
  const budgetedCategories = new Set(budgetStatuses.map((s) => s.category));
  const overBudget = overBudgetCategories(budgetStatuses);
  // まだ超えてはいないが、このペースだと給料日までに超えそうなカテゴリ。
  // 超えたあとの警告(overBudget)と重ならないよう、forecastFor 側で除いてある。
  const progress = data ? payPeriodProgress(data.period) : null;
  const forecasts = progress
    ? forecastOverBudget(budgetStatuses, progress.elapsedDays, progress.remainingDays)
    : [];
  const forecastByCategory = new Map(forecasts.map((f) => [f.category, f]));
  // 予算を付けたカテゴリは全部出し、残りは今までと同じく多い順に。上の予算ぶんだけ
  // 行が増えるので、下の内訳は6件のまま据え置く。
  const unbudgetedBreakdown = categoryBreakdown.filter(([category]) => !budgetedCategories.has(category)).slice(0, 6);

  const showSkeleton = useDelayedFlag(loading);
  if (loading) return showSkeleton ? <ListSkeleton rows={2} /> : null;

  if (!data) {
    // 給与未登録のときはこのカードが主役。
    // 財布の現金は給料日の期間とは関係なく数えられるので、給与が0件でもここに
    // 出しておく(2026-09-04の本番確認)。給与を1件入れるまで現金カードごと
    // 隠れていて、現金だけ記録したい時に入口が無かった。
    //
    // 2026-09-07: ここは .is-empty-fill で画面の下まで引き伸ばしていた(2026-08-30)。
    // 中身は4行しかないのに、スマホで高さ760pxほどの箱になり、文字の上下に
    // 手のひら1枚ぶんの空きができていた。背景の帯を残さないための処理が、
    // かえってカードの間延びとして見えていたので、伸ばすのをやめて中身なりの
    // 高さにする。余るぶんは背景のまま下に残る。
    return (
      <div className="finance-empty mx-auto max-w-4xl space-y-3">
        <Card className="finance-balance-module p-6 lg:p-8">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">使えるお金</p>
          <p className="num mt-4 text-4xl font-medium tabular-nums tracking-[-0.05em] text-navy lg:text-6xl">¥ ---</p>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-600">給与を登録すると、今月使える金額を自動計算します。</p>
          <Button className="mt-6 w-fit" onClick={onAddSalary}>給与を登録する</Button>
        </Card>
        <CashBalanceCard />
      </div>
    );
  }

  const { period, totalFixedCosts, actualSpending, pendingCardSpending, bonusAmount, remaining, perDayUsable } = data;

  // 目標が1件も無ければ null が返り、この節ごと出さない — 貯金を強制しない。
  const savingsPlan = planSavingsGoals(savingsGoals ?? [], remaining);

  const recentTransactions = [...(periodTransactions ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  // 2026-10-12: 並べ方を変えた（参考: サブスクBOX の「分析」）。出している数字・リンクは前と同じ。
  //  - 黒い「使えるお金」の中に、1日あたり・給料日まで・次の給料日・利用ペースをまとめた
  //    （前は4枚の小さなカードに分かれていた）
  //  - 見出しはカードの外に出し、まとめ・カテゴリ・履歴は区切り線つきの行の一覧にした
  const paceText = period.daysUntilNextPayday > 0 ? yen(actualSpending / Math.max(1, expenses.length)) : yen(0);
  const summaryRows: [string, string][] = [
    ["今回の給与", period.hasSalaryForPeriod ? yen(period.salaryAmount) : "未入力"],
    // 賞与は給与と同じく使えるお金に足しているので、0円のときは行ごと出さない。
    ...(bonusAmount > 0 ? ([["今期の賞与", yen(bonusAmount)]] as [string, string][]) : []),
    // 年払いは請求日がこの期に入るときだけ数える(src/lib/subscriptions.ts の chargeInPeriod)。
    ["サブスク・固定費", yen(totalFixedCosts)],
    ["記録した収入", yen(totalIncome)],
    ["記録した支出", yen(totalExpense)],
  ];

  return (
    <div className="finance-control-center lh-finance grid grid-cols-2 gap-x-3 gap-y-6 lg:grid-cols-12 lg:gap-x-5">
      <Card className="finance-balance-module col-span-2 flex flex-col p-5 lg:col-span-8 lg:p-7">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {/* 見出しは折り返させない — 2行に割れると、右のバッジと視覚的に絡まって
                どちらが何の情報か読み取れなくなる(スマホ幅で発生していた)。 */}
            <p className="whitespace-nowrap text-[11px] font-semibold tracking-[0.08em] text-slate-500">使えるお金</p>
            {/* 支出を記録すると、前の残りから新しい残りへ数え下がる(UI/UX 調査メモ 第4弾 A-5)。
                前は key={remaining} で描き直して薄く出し直していたが、描き直すと前の値を
                覚えておけないので、数え上げに置き換えた。数字は数字用の文字(B-1 の .num)。 */}
            <p className={`num mt-3 text-4xl font-medium tabular-nums tracking-[-0.05em] lg:text-6xl ${remaining < 0 ? "text-danger" : "text-navy"}`}>
              <CountingAmount value={remaining} format={yen} resetKey={periodStartStr ?? undefined} />
            </p>
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
        {/* カードの引き落とし前の利用も残額から先に引いている。何を引いたのか
            分からないと「計算が合わない」に見えるので、その内訳をここに出す。 */}
        {pendingCardSpending > 0 && (
          <p className="mt-1.5 text-xs text-slate-500">
            うち、引き落とし前のカード利用 {yen(pendingCardSpending)} を含みます
          </p>
        )}
        <dl className="lh-money__stats lh-finance__stats">
          <div>
            <dt>1日あたり使える金額</dt>
            <dd key={perDayUsable} className="value-change">{yen(perDayUsable)}</dd>
          </div>
          <div>
            <dt>給料日まで</dt>
            <dd>{period.daysUntilNextPayday}日</dd>
          </div>
          <div>
            <dt>次の給料日</dt>
            <dd>{formatDisplayDate(toDateStr(period.nextPayday))}</dd>
          </div>
          <div>
            <dt>利用ペース（1支出あたりの平均）</dt>
            <dd>{paceText}</dd>
          </div>
        </dl>
      </Card>

      <section className="lh-section col-span-2 lg:col-span-4" data-page-block>
        <div className="lh-section__head">
          <h2 className="lh-section__title">今期のまとめ</h2>
        </div>
        <Card className="finance-summary-module lh-group flex-1">
          {summaryRows.map(([label, value]) => (
            <div key={label} className="lh-row lh-row--plain">
              <span className="lh-row__copy"><strong className="lh-row__label">{label}</strong></span>
              <span key={value} className="value-change lh-row__value">{value}</span>
            </div>
          ))}
        </Card>
      </section>

      {savingsPlan && (
        <section className="lh-section col-span-2 lg:col-span-12" data-page-block>
          <div className="lh-section__head">
            <h2 className="lh-section__title">貯金目標</h2>
            <span className="lh-section__note">
              {savingsPlan.allocations.length > 1 && `${savingsPlan.allocations.length}件 · `}
              目標 {yen(savingsPlan.totalTarget)} / 月
            </span>
          </div>
          <Card className="finance-savings-module lh-savings p-5 lg:p-6">
            <p className="lh-savings__kicker">このままいけば残せる額</p>
            <p className="lh-savings__amount mb-3 tabular-nums">
              {yen(savingsPlan.overall.projected)}
            </p>
            <ProgressBar value={savingsPlan.overall.ratio} colorClass={savingsPlan.overall.onTrack ? "bg-success" : "bg-accent"} />
            <p className="mt-2 text-xs text-slate-500">
              {savingsPlan.overall.onTrack
                ? `このままなら目標より ${yen(savingsPlan.overall.surplus)} 多く残せそうです`
                : `目標まであと ${yen(savingsPlan.overall.shortfall)}`}
            </p>

            {/* 目標が2つ以上あるときだけ内訳を出す。1つのときは上の合計と同じ内容なので、
                同じ棒が2本並ぶことになってかえって読みにくい。 */}
            {savingsPlan.allocations.length > 1 && (
              <div className="mt-4 space-y-3 border-t border-white/35 pt-4">
                {savingsPlan.allocations.map(({ goal, allocated, ratio, shortfall, covered }) => (
                  <div key={goal.id}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate text-slate-600">{goal.name}</span>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        <span className="font-semibold text-slate-800">{yen(allocated)}</span> / {yen(goal.monthlyAmount)}
                      </span>
                    </div>
                    <ProgressBar value={ratio} colorClass={covered ? "bg-success" : "bg-accent"} />
                    {!covered && <p className="mt-1 text-[11px] text-slate-400">あと {yen(shortfall)}</p>}
                  </div>
                ))}
                <p className="text-[11px] text-slate-400">
                  {savingsPlan.leftover > 0
                    ? `すべて満たしたうえで ${yen(savingsPlan.leftover)} 余りそうです`
                    : "上の目標から順に埋めた場合の内訳です"}
                </p>
              </div>
            )}
          </Card>
        </section>
      )}

      <CashBalanceCard />

      {/* 内訳も履歴も空なら、空の箱を2つ並べずに1つにまとめる(第8弾 X-5)。 */}
      {categoryBreakdown.length === 0 && budgetStatuses.length === 0 && recentTransactions.length === 0 ? (
        <section className="lh-section col-span-2 lg:col-span-12" data-page-block>
          <div className="lh-section__head">
            <h2 className="lh-section__title">今期の支出</h2>
          </div>
          <Card className="lh-group flex-1">
            <EmptyState
              illustration="expense"
              title="今期の支出記録はありません"
              description="記録すると、カテゴリ別の内訳と最近の履歴がここに出ます。"
              action={{ label: "収支を追加", onClick: () => navigate("/records/expense?new=expense") }}
            />
          </Card>
        </section>
      ) : (
      <>
      <section className="lh-section col-span-2 lg:col-span-6" data-page-block>
        <div className="lh-section__head">
          <h2 className="lh-section__title">カテゴリ別支出</h2>
          <Link to="/settings" className="warm-card__go focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
            予算を設定
          </Link>
        </div>
        <Card className="finance-breakdown-module lh-group flex-1">
          {(overBudget.length > 0 || forecasts.length > 0) && (
            <div className="lh-group__notes">
              {overBudget.length > 0 && (
                <p className="text-xs font-medium text-danger">
                  {overBudget.map((s) => s.category).join("・")} が予算を超えています
                </p>
              )}
              {forecasts.length > 0 && (
                <p className="text-xs font-medium text-warning">
                  このペースだと {forecasts.map((f) => f.category).join("・")} が給料日までに超えそうです
                </p>
              )}
            </div>
          )}

          {categoryBreakdown.length === 0 && budgetStatuses.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">今期の支出記録はありません</p>
          ) : (
            <>
              {/* 予算を決めたカテゴリは、全体に占める割合ではなく上限に対する使い具合で見せる。
                  どれくらい使ったかより「あと何円使えるか」が知りたい行なので、棒の意味を変える。 */}
              {budgetStatuses.map((status) => (
                <div key={status.category} className="lh-row lh-row--bar">
                  <span className="lh-row__icon lh-row__icon--initial" aria-hidden="true">{status.category.slice(0, 1)}</span>
                  <div className="lh-row__copy">
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <strong className="lh-row__label">{status.category}</strong>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        <span className={`font-semibold ${status.over ? "text-danger" : "text-slate-800"}`}>{yen(status.spent)}</span> / {yen(status.budget)}
                      </span>
                    </div>
                    <ProgressBar
                      value={status.ratio}
                      colorClass={
                        status.over
                          ? "bg-danger"
                          : status.nearLimit || forecastByCategory.has(status.category)
                            ? "bg-warning"
                            : "bg-success"
                      }
                    />
                    <p className={`text-[11px] ${status.over ? "text-danger" : "text-slate-400"}`}>
                      {status.over ? `${yen(-status.remaining)} 超過` : `あと ${yen(status.remaining)}`}
                      {forecastByCategory.has(status.category) && (
                        <span className="text-warning">
                          {" "}
                          ・このペースだと {yen(forecastByCategory.get(status.category)!.projected)} の見込み
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              ))}

              {budgetStatuses.length > 0 && unbudgetedBreakdown.length > 0 && (
                <p className="lh-group__divider">予算を決めていないカテゴリ</p>
              )}

              {unbudgetedBreakdown.map(([category, amount]) => (
                <div key={category} className="lh-row lh-row--bar">
                  <span className="lh-row__icon lh-row__icon--initial" aria-hidden="true">{category.slice(0, 1)}</span>
                  <div className="lh-row__copy">
                    <div className="flex justify-between text-xs"><strong className="lh-row__label">{category}</strong><span className="font-semibold tabular-nums text-slate-800">{yen(amount)}</span></div>
                    <ProgressBar value={totalExpense > 0 ? (amount / totalExpense) * 100 : 0} />
                  </div>
                </div>
              ))}
            </>
          )}
        </Card>
      </section>

      <section className="lh-section col-span-2 lg:col-span-6" data-page-block>
        <div className="lh-section__head">
          <h2 className="lh-section__title">最近の履歴</h2>
        </div>
        <Card className="finance-history-module lh-group flex-1">
          {recentTransactions.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">履歴はありません</p>
          ) : (
            recentTransactions.map((transaction) => (
              <div key={transaction.id} className="lh-row">
                <span
                  className={`lh-row__icon lh-row__icon--initial ${transaction.type === "income" ? "is-income" : ""}`}
                  aria-hidden="true"
                >
                  {transaction.category.slice(0, 1)}
                </span>
                <div className="lh-row__copy"><strong>{transaction.category}</strong><small>{formatDisplayDate(transaction.date)}</small></div>
                <span className={`lh-row__value ${transaction.type === "income" ? "text-success" : ""}`}>{transaction.type === "income" ? "+" : "−"}{yen(transaction.amount)}</span>
              </div>
            ))
          )}
        </Card>
      </section>
      </>
      )}
    </div>
  );
}
