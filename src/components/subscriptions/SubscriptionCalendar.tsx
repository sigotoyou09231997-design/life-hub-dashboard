import { useMemo, useState } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDisplayDate, formatMonthTitle, toDateStr } from "../../lib/date";
import { billingDatesInRange, type SubscriptionItem } from "../../lib/subscriptions";
import { ServiceIcon } from "./ServiceIcon";

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
/** マスに並べるアイコンの数。超えたぶんは「+N」。 */
const ICONS_PER_CELL = 2;

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

interface Charge {
  date: string;
  item: SubscriptionItem;
  trialEnds: boolean;
}

interface Props {
  items: SubscriptionItem[];
  today: string;
  onOpen: (item: SubscriptionItem) => void;
}

/**
 * 請求日のカレンダー(参考: サブスクBOX の「カレンダー」)。マスにはその日に請求される
 * サービスのアイコン、下にはその月の請求を日付順に並べる。マスを押すとその日だけに絞る。
 * 予定・タスクの月表示(MonthView)とは別物 — あちらは予定の帯、こちらはお金だけ。
 */
export function SubscriptionCalendar({ items, today, onOpen }: Props) {
  const [month, setMonth] = useState(() => startOfMonth(new Date(`${today}T00:00:00`)));
  const [selected, setSelected] = useState<string | null>(null);

  const monthStart = toDateStr(startOfMonth(month));
  const monthEnd = toDateStr(endOfMonth(month));
  const gridStart = startOfWeek(month, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });

  const charges = useMemo(() => {
    const list: Charge[] = [];
    for (const item of items) {
      for (const date of billingDatesInRange(item, monthStart, monthEnd)) {
        list.push({ date, item, trialEnds: item.detail?.trialEndDate === date });
      }
    }
    return list.sort((a, b) => a.date.localeCompare(b.date) || b.item.cost.amount - a.item.cost.amount);
  }, [items, monthStart, monthEnd]);

  const byDate = new Map<string, Charge[]>();
  for (const charge of charges) byDate.set(charge.date, [...(byDate.get(charge.date) ?? []), charge]);
  const monthTotal = charges.reduce((sum, charge) => sum + charge.item.cost.amount, 0);
  const shown = selected ? (byDate.get(selected) ?? []) : charges;

  function moveMonth(next: Date) {
    setMonth(startOfMonth(next));
    setSelected(null);
  }

  return (
    <div className="subs-calendar">
      <div className="subs-calendar__card">
        <div className="subs-calendar__head">
          <button type="button" className="subs-calendar__nav" onClick={() => moveMonth(subMonths(month, 1))} aria-label="前の月">
            <ChevronLeft size={18} />
          </button>
          <div className="subs-calendar__title">
            <strong>{formatMonthTitle(month)}</strong>
            <span>この月の請求 {yen(monthTotal)}</span>
          </div>
          <button type="button" className="subs-calendar__nav" onClick={() => moveMonth(addMonths(month, 1))} aria-label="次の月">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="subs-calendar__weekdays" aria-hidden="true">
          {WEEKDAYS.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>
        <div className="subs-calendar__grid">
          {eachDayOfInterval({ start: gridStart, end: gridEnd }).map((day) => {
            const date = toDateStr(day);
            const inMonth = date >= monthStart && date <= monthEnd;
            const dayCharges = inMonth ? (byDate.get(date) ?? []) : [];
            const isSelected = selected === date;
            return (
              <button
                key={date}
                type="button"
                disabled={!inMonth || dayCharges.length === 0}
                onClick={() => setSelected(isSelected ? null : date)}
                aria-pressed={isSelected}
                aria-label={
                  dayCharges.length > 0
                    ? `${formatDisplayDate(date)} ${dayCharges.map((c) => c.item.cost.title).join("・")}`
                    : formatDisplayDate(date)
                }
                className={`subs-calendar__cell${inMonth ? "" : " is-outside"}${date === today ? " is-today" : ""}${isSelected ? " is-selected" : ""}${dayCharges.length > 0 ? " has-charge" : ""}`}
              >
                <span className="subs-calendar__day">{day.getDate()}</span>
                {dayCharges.length > 0 && (
                  <span className="subs-calendar__icons">
                    {dayCharges.slice(0, ICONS_PER_CELL).map((charge) => (
                      <ServiceIcon
                        key={charge.item.cost.id ?? charge.item.cost.title}
                        title={charge.item.cost.title}
                        serviceKey={charge.item.detail?.serviceKey}
                        size="sm"
                      />
                    ))}
                    {dayCharges.length > ICONS_PER_CELL && (
                      <span className="subs-calendar__more">+{dayCharges.length - ICONS_PER_CELL}</span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section className="lh-section">
        <div className="lh-section__head">
          <h2 className="lh-section__title">{selected ? formatDisplayDate(selected) : "この月の請求"}</h2>
          {selected && (
            <button type="button" className="subs-link" onClick={() => setSelected(null)}>
              月ぜんぶ
            </button>
          )}
        </div>
        <div className="warm-card lh-group">
          {shown.length === 0 ? (
            <p className="subs-empty">この月に請求はありません。</p>
          ) : (
            shown.map((charge) => (
              <button
                key={`${charge.item.cost.id}-${charge.date}`}
                type="button"
                className="lh-row subs-row"
                onClick={() => onOpen(charge.item)}
              >
                <ServiceIcon title={charge.item.cost.title} serviceKey={charge.item.detail?.serviceKey} />
                <span className="lh-row__copy">
                  <strong>{charge.item.cost.title}</strong>
                  <small>
                    {formatDisplayDate(charge.date)}
                    {charge.trialEnds ? " · 無料体験おわり" : ""}
                  </small>
                </span>
                <span className="subs-row__amount">{yen(charge.item.cost.amount)}</span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
