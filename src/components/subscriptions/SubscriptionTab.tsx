import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, CreditCard, Plus } from "lucide-react";
import { db } from "../../db/schema";
import { todayStr } from "../../lib/date";
import {
  daysUntil,
  monthlyEquivalent,
  nextBillingDate,
  pairSubscriptions,
  remainingLabel,
  sortByNextBilling,
  summarizeSubscriptions,
  yearlyEquivalent,
  type SubscriptionItem,
} from "../../lib/subscriptions";
import type { SubscriptionTemplate } from "../../lib/subscriptionTemplates";
import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import { Tabs } from "../ui/Tabs";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/ListSkeleton";
import { useToast } from "../ui/ToastProvider";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { ServiceIcon } from "./ServiceIcon";
import { ServicePicker } from "./ServicePicker";
import { SubscriptionForm } from "./SubscriptionForm";
import { SubscriptionActions } from "./SubscriptionActions";
import { SubscriptionRow, type AmountUnit } from "./SubscriptionRow";
import { SubscriptionCalendar } from "./SubscriptionCalendar";
import { SubscriptionAnalysis } from "./SubscriptionAnalysis";
import { AnthropicBillingPanel } from "./AnthropicBillingPanel";
import { isClaudeSubscription } from "../../lib/anthropicBilling";

type View = "list" | "calendar" | "analysis";

/** お金管理の「＋」(サブスクのタブを見ている時)から、追加のシートを開く合図。
 * シートの中身(サービスを選ぶ→フォーム)はこのタブが持っているので、外からは合図だけ送る。 */
const OPEN_ADD_EVENT = "lifehub:open-subscription-add";

export function openSubscriptionAdd() {
  window.dispatchEvent(new Event(OPEN_ADD_EVENT));
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

const UNIT_KEY = "lifehub.subscriptions.unit";

function loadUnit(): AmountUnit {
  try {
    return localStorage.getItem(UNIT_KEY) === "year" ? "year" : "month";
  } catch {
    return "month";
  }
}

/** 追加のシートの中身。null=サービスを選ぶ段、それ以外=フォームの段。 */
type AddStep = { template: SubscriptionTemplate | null } | null;

/**
 * お金管理の「サブスク」タブ(2026-10-12、参考: App Store の「サブスクBOX」)。
 * 固定費をサブスク管理として見せる。家賃などの固定費もここに並ぶ。
 *
 *   黒いカード … 月額／年額の合計・今月払う額・次の請求・高い順トップ3
 *   一覧       … 次の請求が近い順(残り日数と進み具合の棒)、無料体験中、開始予定、解約済み
 *   カレンダー … 請求日にサービスのアイコン
 *   分析       … カテゴリ別の円グラフと、解約で浮いたお金
 */
export function SubscriptionTab() {
  const showToast = useToast();
  const costs = useLiveQuery(() => db.fixedCosts.toArray(), []);
  const details = useLiveQuery(() => db.subscriptionDetails.toArray(), []);
  const [unit, setUnitState] = useState<AmountUnit>(loadUnit);
  const [view, setView] = useState<View>("list");
  const [showTop, setShowTop] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addStep, setAddStep] = useState<AddStep>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const loading = costs === undefined || details === undefined;
  const showSkeleton = useDelayedFlag(loading);

  function setUnit(next: AmountUnit) {
    setUnitState(next);
    try {
      localStorage.setItem(UNIT_KEY, next);
    } catch {
      // 覚えられなくても表示は切り替わる
    }
  }

  const today = todayStr();
  const items = pairSubscriptions(costs ?? [], details ?? []);
  const summary = summarizeSubscriptions(items, today);
  const upcoming = sortByNextBilling(summary.active, today);
  const next = upcoming[0];
  const nextDate = next ? nextBillingDate(next, today) : null;
  // 編集中のものは、保存や解約で中身が変わっても開いたまま最新を見せたいので id で引き直す。
  const editing = editingId ? items.find((item) => item.cost.id === editingId) : undefined;

  const total = unit === "year" ? summary.yearlyTotal : summary.monthlyTotal;
  const perDay = unit === "year" ? summary.yearlyTotal / 365 : summary.monthlyTotal / 30;
  const unitLabel = unit === "year" ? "/年" : "/月";
  const amountOf = (item: SubscriptionItem) => (unit === "year" ? yearlyEquivalent(item) : monthlyEquivalent(item));

  function openAdd() {
    setAddStep(null);
    setAdding(true);
  }

  useEffect(() => {
    const handleOpen = () => {
      setAddStep(null);
      setAdding(true);
    };
    window.addEventListener(OPEN_ADD_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_ADD_EVENT, handleOpen);
  }, []);

  function closeAdd() {
    setAdding(false);
    setAddStep(null);
  }

  if (loading) return showSkeleton ? <ListSkeleton /> : null;

  return (
    <div className="subs-home">
      <section className="subs-total" data-page-block>
        <div className="subs-total__head">
          <p className="subs-total__label">{unit === "year" ? "1年の支払い" : "毎月の支払い"}</p>
          <div className="subs-unit" role="group" aria-label="合計の単位">
            <button type="button" aria-pressed={unit === "month"} onClick={() => setUnit("month")}>
              月額
            </button>
            <button type="button" aria-pressed={unit === "year"} onClick={() => setUnit("year")}>
              年額
            </button>
          </div>
        </div>
        <p key={`${unit}-${Math.round(total)}`} className="subs-total__amount tabular-nums">
          {yen(total)}
          <small>{unitLabel}</small>
        </p>
        <p className="subs-total__note">
          {summary.active.length}件のサブスク・固定費
          {summary.yearlyCount > 0 &&
            (unit === "year"
              ? ` · 毎月払いは12か月ぶんで合計`
              : ` · 年払い${summary.yearlyCount}件は月あたりに直して合計`)}
        </p>
        <dl className="subs-total__stats">
          <div>
            <dt>今月払う額</dt>
            <dd>{yen(summary.thisMonthCharge)}</dd>
          </div>
          <div>
            <dt>次の請求</dt>
            <dd className="subs-total__next">
              {next && nextDate ? (
                <>
                  <ServiceIcon title={next.cost.title} serviceKey={next.detail?.serviceKey} size="sm" />
                  <span>{remainingLabel(daysUntil(nextDate, today))}</span>
                </>
              ) : (
                "なし"
              )}
            </dd>
          </div>
          <div>
            <dt>1日あたり</dt>
            <dd>{yen(perDay)}</dd>
          </div>
        </dl>
        {summary.top.length > 0 && (
          <>
            <button
              type="button"
              className="subs-total__toggle"
              aria-expanded={showTop}
              onClick={() => setShowTop((open) => !open)}
            >
              高い順トップ{summary.top.length}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {showTop && (
              <ol className="subs-total__top">
                {summary.top.map((item, index) => (
                  <li key={item.cost.id ?? item.cost.title}>
                    <span className="subs-total__rank">{index + 1}</span>
                    <ServiceIcon title={item.cost.title} serviceKey={item.detail?.serviceKey} size="sm" />
                    <span className="subs-total__name">{item.cost.title}</span>
                    <span className="subs-total__value">
                      {yen(amountOf(item))}
                      <small>{unitLabel}</small>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </section>

      {/* 二段目のタブは、上のタブ(サブスク／サマリー…)と見分けがつくよう、見出しの行の右の小さな切り替えにする(第8弾 X-6)。 */}
      <div className="subs-views-row">
        <span className="subs-views-row__label">{view === "list" ? "一覧" : view === "calendar" ? "請求日のカレンダー" : "分析"}</span>
        <Tabs<View>
          className="subs-views"
          dense
          options={[
            { value: "list", label: "一覧" },
            { value: "calendar", label: "カレンダー" },
            { value: "analysis", label: "分析" },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      {view === "list" && (
        <div className="subs-list">
          {items.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              illustration="subscription"
              title="サブスク・固定費はまだありません"
              description="Netflix や家賃など、毎月・毎年払っているものを入れると、合計と次の請求日がひと目で分かります。"
              action={{ label: "サブスクを追加", onClick: openAdd }}
              card
            />
          ) : (
            <>
              <section className="lh-section">
                <div className="lh-section__head">
                  <h2 className="lh-section__title">契約中</h2>
                  <span className="lh-section__note">次の請求が近い順</span>
                </div>
                <div className="warm-card lh-group">
                  {upcoming.length === 0 ? (
                    <p className="subs-empty">請求が続いているものはありません。</p>
                  ) : (
                    upcoming.map((item) => (
                      <SubscriptionRow
                        key={item.cost.id}
                        item={item}
                        today={today}
                        unit={unit}
                        onOpen={(opened) => setEditingId(opened.cost.id ?? null)}
                      />
                    ))
                  )}
                </div>
              </section>

              {summary.trial.length > 0 && (
                <section className="lh-section">
                  <div className="lh-section__head">
                    <h2 className="lh-section__title">無料体験中</h2>
                    <span className="lh-section__note">終わる日から請求が始まります</span>
                  </div>
                  <div className="warm-card lh-group">
                    {sortByNextBilling(summary.trial, today).map((item) => (
                      <SubscriptionRow
                        key={item.cost.id}
                        item={item}
                        today={today}
                        unit={unit}
                        onOpen={(opened) => setEditingId(opened.cost.id ?? null)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {summary.scheduled.length > 0 && (
                <section className="lh-section">
                  <div className="lh-section__head">
                    <h2 className="lh-section__title">開始予定</h2>
                    <span className="lh-section__note">始まるまで合計に入りません</span>
                  </div>
                  <div className="warm-card lh-group">
                    {sortByNextBilling(summary.scheduled, today).map((item) => (
                      <SubscriptionRow
                        key={item.cost.id}
                        item={item}
                        today={today}
                        unit={unit}
                        onOpen={(opened) => setEditingId(opened.cost.id ?? null)}
                      />
                    ))}
                  </div>
                </section>
              )}

              <Button className="w-full lh-add-end" onClick={openAdd}>
                <Plus size={16} aria-hidden="true" /> サブスクを追加
              </Button>

              {summary.cancelled.length > 0 && (
                <section className="lh-section">
                  <button
                    type="button"
                    className="lh-section__head subs-section-toggle"
                    aria-expanded={showCancelled}
                    onClick={() => setShowCancelled((open) => !open)}
                  >
                    <h2 className="lh-section__title">解約済み</h2>
                    <span className="lh-section__note">
                      {summary.cancelled.length}件
                      {summary.savedMonthly > 0 && ` · 毎月 ${yen(summary.savedMonthly)} 浮いています`}
                    </span>
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                  {showCancelled && (
                    <div className="warm-card lh-group">
                      {[...summary.cancelled]
                        .sort((a, b) => (b.detail?.cancelledAt ?? "").localeCompare(a.detail?.cancelledAt ?? ""))
                        .map((item) => (
                          <SubscriptionRow
                            key={item.cost.id}
                            item={item}
                            today={today}
                            unit={unit}
                            onOpen={(opened) => setEditingId(opened.cost.id ?? null)}
                          />
                        ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      )}

      {view === "calendar" && (
        <SubscriptionCalendar items={items} today={today} onOpen={(item) => setEditingId(item.cost.id ?? null)} />
      )}

      {view === "analysis" && <SubscriptionAnalysis summary={summary} unit={unit} />}

      <Sheet open={adding} onClose={closeAdd} title={addStep ? "サブスクを追加" : "サービスを選ぶ"}>
        {adding &&
          (addStep ? (
            <SubscriptionForm
              key={addStep.template?.key ?? "custom"}
              template={addStep.template}
              onBack={() => setAddStep(null)}
              onSaved={() => {
                closeAdd();
                showToast("追加しました");
              }}
              onCancel={closeAdd}
            />
          ) : (
            <ServicePicker onPick={(template) => setAddStep({ template })} />
          ))}
      </Sheet>

      <Sheet open={editing !== undefined} onClose={() => setEditingId(null)} title="サブスクを編集">
        {editing && (
          <>
            {/* Claude のサブスクだけ、Anthropic の料金(サブスク+API クレジット)を月ごとに出す(Gmail の領収書から)。 */}
            {isClaudeSubscription(editing.cost.title, editing.detail?.serviceKey) && <AnthropicBillingPanel />}
            <SubscriptionForm
              key={editing.cost.id}
              initial={editing}
              onSaved={() => {
                setEditingId(null);
                showToast("保存しました");
              }}
              onCancel={() => setEditingId(null)}
            />
            <SubscriptionActions
              item={editing}
              today={today}
              onDone={(message, close) => {
                showToast(message);
                if (close) setEditingId(null);
              }}
            />
          </>
        )}
      </Sheet>
    </div>
  );
}

