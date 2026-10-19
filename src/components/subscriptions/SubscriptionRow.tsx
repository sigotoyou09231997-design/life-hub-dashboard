import { ChevronRight } from "lucide-react";
import { formatShortDate } from "../../lib/date";
import {
  cycleOf,
  cycleProgress,
  daysUntil,
  monthlyEquivalent,
  nextBillingDate,
  remainingLabel,
  scheduleLabel,
  statusOf,
  urgencyOf,
  yearlyEquivalent,
  type SubscriptionItem,
} from "../../lib/subscriptions";
import { ServiceIcon } from "./ServiceIcon";
import { isClaudeSubscription } from "../../lib/anthropicBilling";
import { splitTaxIncludedYen } from "../../lib/claudePrice";

export type AmountUnit = "month" | "year";

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

interface Props {
  item: SubscriptionItem;
  today: string;
  unit: AmountUnit;
  onOpen: (item: SubscriptionItem) => void;
}

/**
 * サブスク1件の行。左にアイコン、真ん中に名前と請求の決まり、右に金額と残り日数。
 * 下の細い棒は、前の請求日から次の請求日までの進み具合(残りが少ないほど橙→赤)。
 */
export function SubscriptionRow({ item, today, unit, onOpen }: Props) {
  const { cost, detail } = item;
  const status = statusOf(item, today);
  const next = nextBillingDate(item, today);
  const days = next ? daysUntil(next, today) : null;
  const urgency = days == null ? "calm" : urgencyOf(days);
  const yearly = cycleOf(item) === "yearly";

  // 払い方と違う単位で見ているときだけ、換算した額を添える(年払いを月額で見ている時など)。
  const converted =
    unit === "month" && yearly
      ? `月 ${yen(monthlyEquivalent(item))}`
      : unit === "year" && !yearly
        ? `年 ${yen(yearlyEquivalent(item))}`
        : null;

  // Claude はドルで請求されて消費税が足されるので、登録の金額(引き落としの額＝税込)に税抜を添える。
  const taxNote = isClaudeSubscription(cost.title, detail?.serviceKey)
    ? `税込（税抜 ${yen(splitTaxIncludedYen(cost.amount).netYen)}）`
    : null;

  let note: string;
  if (status === "trial" && next) note = `無料体験 · ${formatShortDate(next)}から請求`;
  else if (status === "scheduled" && next) note = `${formatShortDate(next)}に開始`;
  else if (status === "cancelled") note = detail?.cancelledAt ? `${formatShortDate(detail.cancelledAt)}に解約` : "止めています";
  else note = `${scheduleLabel(item)} · ${cost.category}`;

  return (
    <button
      type="button"
      className={`lh-row subs-row is-${status}`}
      onClick={() => onOpen(item)}
      aria-label={`${cost.title}を開く`}
    >
      <ServiceIcon title={cost.title} serviceKey={detail?.serviceKey} />
      <span className="lh-row__copy">
        <strong>{cost.title}</strong>
        <small>{note}</small>
      </span>
      <span className="subs-row__aside">
        <span className="subs-row__amount">
          {yen(cost.amount)}
          <small>{yearly ? "/年" : "/月"}</small>
        </span>
        {taxNote && <span className="subs-row__sub">{taxNote}</span>}
        {status === "cancelled" ? (
          converted ? <span className="subs-row__sub">{converted}</span> : null
        ) : (
          <span className="subs-row__meta">
            {converted && <span className="subs-row__sub">{converted}</span>}
            {days != null && (
              <span className={`subs-days is-${urgency}${status === "trial" ? " is-trial" : ""}`}>
                {remainingLabel(days)}
              </span>
            )}
          </span>
        )}
      </span>
      <ChevronRight size={16} className="lh-row__chev" aria-hidden="true" />
      {status !== "cancelled" && (
        <>
          {/* 線の意味を書く(第8弾 M-2): 線は「次の請求まで」の進み具合。右の「あと◯日」と一体。 */}
          <span className="subs-row__track-label" aria-hidden="true">次の請求まで</span>
          <span className="subs-row__track" aria-hidden="true">
            <span
              className={`subs-row__fill is-${urgency}`}
              style={{ transform: `scaleX(${status === "active" ? cycleProgress(item, today) : 0})` }}
            />
          </span>
        </>
      )}
    </button>
  );
}
