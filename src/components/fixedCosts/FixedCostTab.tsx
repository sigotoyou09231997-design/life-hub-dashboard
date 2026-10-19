import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Home, Pause, Play, Plus, Trash2 } from "lucide-react";
import { db } from "../../db/schema";
import { formatDisplayDate, formatShortDate, toDateStr, todayStr } from "../../lib/date";
import { isFixedExpense, salarySplit, sortByPayDay } from "../../lib/fixedCosts";
import {
  cycleOf,
  daysUntil,
  nextBillingDate,
  pairSubscriptions,
  remainingLabel,
  summarizeSubscriptions,
  type SubscriptionItem,
} from "../../lib/subscriptions";
import { cancelSubscription, deleteSubscription, resumeSubscription } from "../../lib/subscriptionStore";
import { usePayPeriodBudget } from "../../hooks/usePayPeriodBudget";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/ListSkeleton";
import { Sheet } from "../ui/Sheet";
import { useConfirm } from "../ui/ConfirmProvider";
import { useToast } from "../ui/ToastProvider";
import { FixedCostForm } from "./FixedCostForm";

/** お金管理の「＋」(固定費のタブを見ている時)から、追加のシートを開く合図。 */
const OPEN_ADD_EVENT = "lifehub:open-fixed-cost-add";

export function openFixedCostAdd() {
  window.dispatchEvent(new Event(OPEN_ADD_EVENT));
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;

/** 一覧の左の日付の札。毎月は「27日」、年に1回は「3月 / 1日」。 */
function DayBadge({ item }: { item: SubscriptionItem }) {
  const yearly = cycleOf(item) === "yearly";
  return (
    <span className={`fx-day${yearly ? " is-yearly" : ""}`} aria-hidden="true">
      {yearly && <small className="fx-day__month">{item.detail?.billingMonth ?? 1}月</small>}
      <b>{item.cost.dueDay}</b>
      <small>日</small>
    </span>
  );
}

function FixedRow({ item, today, onOpen }: { item: SubscriptionItem; today: string; onOpen: () => void }) {
  const yearly = cycleOf(item) === "yearly";
  const next = item.cost.active ? nextBillingDate(item, today) : null;
  const days = next ? daysUntil(next, today) : null;
  return (
    <li>
      <button type="button" className={`fx-row${item.cost.active ? "" : " is-stopped"}`} onClick={onOpen} aria-label={`${item.cost.title}を開く`}>
        <DayBadge item={item} />
        <span className="fx-row__copy">
          <strong>{item.cost.title}</strong>
          <small>
            {item.cost.category === "その他の固定費" ? "その他" : item.cost.category}
            {yearly ? " · 年に1回" : ""}
            {days != null && days <= 7 ? ` · ${remainingLabel(days)}` : ""}
          </small>
        </span>
        <span className="fx-row__amount">
          {yen(item.cost.amount)}
          <small>{yearly ? "/年" : "/月"}</small>
        </span>
      </button>
    </li>
  );
}

/**
 * 給与から何がいくら引かれるか(今の給料の期間)。使えるお金(src/hooks/usePayPeriodBudget.ts)と同じ数字を、
 * 給与を1本の帯にして「固定費・サブスク・使った額・残り」に分けて見せる。
 */
function SalaryBreakdown() {
  const { data, loading } = usePayPeriodBudget();
  if (loading) return null;
  if (!data || !data.period.hasSalaryForPeriod) {
    return (
      <section className="fx-salary" data-page-block>
        <p className="fx-salary__title">給与からの引き方</p>
        <p className="fx-salary__empty">今の給料の期間の給与を「給与」のタブで登録すると、給与から固定費・サブスク・使った額を引いた残りがここに出ます。</p>
      </section>
    );
  }
  const salary = data.period.salaryAmount + data.bonusAmount;
  const split = salarySplit({
    salary,
    fixed: data.fixedExpenseTotal,
    subscriptions: data.subscriptionTotal,
    spent: data.actualSpending + data.pendingCardSpending,
  });
  const pct = (share: number) => `${(share * 100).toFixed(2)}%`;
  return (
    <section className="fx-salary" data-page-block aria-label="給与からの引き方">
      <div className="fx-salary__head">
        <p className="fx-salary__title">給与からの引き方</p>
        <small>{formatShortDate(toDateStr(data.period.periodStart))}からの給料の期間</small>
      </div>
      <div className="fx-salary__bar" aria-hidden="true">
        <span className="is-fixed" style={{ width: pct(split.shares.fixed) }} />
        <span className="is-subs" style={{ width: pct(split.shares.subscriptions) }} />
        <span className="is-spent" style={{ width: pct(split.shares.spent) }} />
      </div>
      <dl className="fx-salary__rows">
        <div>
          <dt>給与{data.bonusAmount > 0 ? "（賞与を含む）" : ""}</dt>
          <dd>{yen(salary)}</dd>
        </div>
        <div>
          <dt>
            <i className="is-fixed" aria-hidden="true" />
            固定費
          </dt>
          <dd>−{yen(split.fixed)}</dd>
        </div>
        <div>
          <dt>
            <i className="is-subs" aria-hidden="true" />
            サブスク
          </dt>
          <dd>−{yen(split.subscriptions)}</dd>
        </div>
        <div>
          <dt>
            <i className="is-spent" aria-hidden="true" />
            使った額
          </dt>
          <dd>−{yen(split.spent)}</dd>
        </div>
        <div className={`is-total${split.remaining < 0 ? " is-over" : ""}`}>
          <dt>残り（使えるお金）</dt>
          <dd>{yen(split.remaining)}</dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * お金管理の「固定費」タブ(2026-10-20)。家賃・光熱費・保険など、サブスクではない毎月(年に1回)の支払い。
 * サブスクのタブ(黒い合計カード・サービスのアイコン・残り日数の棒)とは見た目を分け、
 * 給与からの引き方の帯と、支払日の順の一覧(左に日付の札)にした。どの支払いがどちらに並ぶかは種類で決まる(src/lib/fixedCosts.ts)。
 */
export function FixedCostTab() {
  const showToast = useToast();
  const confirm = useConfirm();
  const costs = useLiveQuery(() => db.fixedCosts.toArray(), []);
  const details = useLiveQuery(() => db.subscriptionDetails.toArray(), []);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const loading = costs === undefined || details === undefined;
  const showSkeleton = useDelayedFlag(loading);

  useEffect(() => {
    const handleOpen = () => setAdding(true);
    window.addEventListener(OPEN_ADD_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_ADD_EVENT, handleOpen);
  }, []);

  if (loading) return showSkeleton ? <ListSkeleton /> : null;

  const today = todayStr();
  const items = pairSubscriptions(costs ?? [], details ?? []).filter((item) => isFixedExpense(item.cost));
  const summary = summarizeSubscriptions(items, today);
  const active = sortByPayDay(items.filter((item) => item.cost.active));
  const stopped = sortByPayDay(items.filter((item) => !item.cost.active));
  const editing = editingId ? items.find((item) => item.cost.id === editingId) : undefined;
  const upcoming = active
    .map((item) => ({ item, next: nextBillingDate(item, today) }))
    .filter((entry): entry is { item: SubscriptionItem; next: string } => entry.next !== null)
    .sort((a, b) => a.next.localeCompare(b.next))[0];

  return (
    <div className="fx-home">
      <SalaryBreakdown />

      {items.length === 0 ? (
        <EmptyState
          icon={Home}
          title="固定費はまだありません"
          description="家賃・光熱費・通信費・保険など、毎月(または年に1回)決まって払うものを入れると、給与から先に引いて使えるお金を出します。"
          action={{ label: "固定費を追加", onClick: () => setAdding(true) }}
          card
        />
      ) : (
        <>
          <section className="fx-total" data-page-block>
            <div>
              <p className="fx-total__label">毎月の固定費</p>
              <p className="fx-total__amount tabular-nums">
                {yen(summary.monthlyTotal)}
                <small>/月</small>
              </p>
              <p className="fx-total__note">
                {summary.active.length}件
                {summary.yearlyCount > 0 ? ` · 年に1回のもの${summary.yearlyCount}件は月あたりに直して合計` : ""}
              </p>
            </div>
            <dl className="fx-total__stats">
              <div>
                <dt>今月払う額</dt>
                <dd>{yen(summary.thisMonthCharge)}</dd>
              </div>
              {upcoming && (
                <div>
                  <dt>次の支払い</dt>
                  <dd>
                    {formatShortDate(upcoming.next)} {upcoming.item.cost.title}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="lh-section fx-list-section" data-page-block>
            <div className="lh-section__head">
              <h2 className="lh-section__title">支払日の順</h2>
              <span className="lh-section__note">毎月の支払い → 年に1回</span>
            </div>
            <ul className="fx-list">
              {active.map((item) => (
                <FixedRow key={item.cost.id} item={item} today={today} onOpen={() => setEditingId(item.cost.id ?? null)} />
              ))}
            </ul>
          </section>

          {stopped.length > 0 && (
            <section className="lh-section" data-page-block>
              <button type="button" className="fx-stopped-toggle" aria-expanded={showStopped} onClick={() => setShowStopped((open) => !open)}>
                止めている固定費（{stopped.length}）
              </button>
              {showStopped && (
                <ul className="fx-list">
                  {stopped.map((item) => (
                    <FixedRow key={item.cost.id} item={item} today={today} onOpen={() => setEditingId(item.cost.id ?? null)} />
                  ))}
                </ul>
              )}
            </section>
          )}

          <Button className="w-full lh-add-end" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden="true" /> 固定費を追加
          </Button>
        </>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="固定費を追加">
        {adding && (
          <FixedCostForm
            onSaved={() => {
              setAdding(false);
              showToast("追加しました");
            }}
            onCancel={() => setAdding(false)}
          />
        )}
      </Sheet>

      <Sheet open={editing !== undefined} onClose={() => setEditingId(null)} title="固定費を編集">
        {editing && (
          <>
            <FixedCostForm
              key={editing.cost.id}
              initial={editing}
              onSaved={() => {
                setEditingId(null);
                showToast("保存しました");
              }}
              onCancel={() => setEditingId(null)}
            />
            <div className="fx-actions">
              {editing.cost.active ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    await cancelSubscription(editing, today);
                    setEditingId(null);
                    showToast("止めました。給与からは引かれなくなります");
                  }}
                >
                  <Pause size={15} aria-hidden="true" /> 止める（引っ越し・解約など）
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    await resumeSubscription(editing);
                    showToast("再開しました");
                  }}
                >
                  <Play size={15} aria-hidden="true" /> 再開する
                </Button>
              )}
              {editing.detail?.cancelledAt && !editing.cost.active && (
                <p className="fx-actions__note">{formatDisplayDate(editing.detail.cancelledAt)}に止めました。</p>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  const ok = await confirm({
                    title: `「${editing.cost.title}」を削除しますか?`,
                    message: "誤って登録したもの向けです。払うのをやめた時は「止める」を使うと、記録が残ります。",
                    confirmLabel: "削除する",
                    tone: "danger",
                  });
                  if (!ok) return;
                  await deleteSubscription(editing);
                  setEditingId(null);
                  showToast("削除しました");
                }}
              >
                <Trash2 size={15} aria-hidden="true" /> 削除
              </Button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
