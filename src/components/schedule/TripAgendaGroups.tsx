import { useState } from "react";
import { ChevronDown, Plane } from "lucide-react";
import { formatDisplayDate, formatShortDate } from "../../lib/date";
import { spanEndDate } from "../../lib/eventSpan";
import { TripAgendaList, type TripAgendaEntry } from "./TripAgendaList";

interface Props {
  items: TripAgendaEntry[];
  /** 検索語が入っている時は、旅行の中身がそのまま検索にかかるように、全部開いた状態で出す。 */
  forceOpen?: boolean;
}

/**
 * 一覧タブの「今後の旅行の予定」(第8弾 S-3、2026-10-18)。
 * 前は旅行の日程(起床・自宅出発・駅名…)が数十〜百件そのまま並び、ふつうの予定が探せなかった。
 * 旅行ごとに1行(名前・期間・件数)にまとめ、押すと日ごとに開く。
 */
export function TripAgendaGroups({ items, forceOpen = false }: Props) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  if (items.length === 0) return null;
  const groups = new Map<string, { tripName: string; items: TripAgendaEntry[] }>();
  for (const item of items) {
    const group = groups.get(item.tripId) ?? { tripName: item.tripName, items: [] };
    group.items.push(item);
    groups.set(item.tripId, group);
  }
  return (
    <div className="trip-agenda-groups">
      {[...groups.entries()].map(([tripId, group]) => {
        const sorted = [...group.items].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
        const first = sorted[0].date;
        const last = sorted.reduce((max, item) => (spanEndDate(item) > max ? spanEndDate(item) : max), first);
        const isOpen = forceOpen || open.has(tripId);
        const dates = [...new Set(sorted.map((item) => item.date))];
        return (
          <div key={tripId} className={`trip-agenda-group${isOpen ? " is-open" : ""}`}>
            <button
              type="button"
              className="trip-agenda-group__head"
              aria-expanded={isOpen}
              onClick={() => setOpen((prev) => {
                const next = new Set(prev);
                if (next.has(tripId)) next.delete(tripId);
                else next.add(tripId);
                return next;
              })}
            >
              <span className="trip-agenda-group__icon" aria-hidden="true">
                <Plane size={15} />
              </span>
              <span className="trip-agenda-group__copy">
                <strong>{group.tripName}</strong>
                <small>
                  {formatShortDate(first)}
                  {last !== first ? ` 〜 ${formatShortDate(last)}` : ""}
                </small>
              </span>
              <span className="trip-agenda-group__count">{sorted.length}件</span>
              <ChevronDown size={16} className="trip-agenda-group__chevron" aria-hidden="true" />
            </button>
            {isOpen && (
              <div className="trip-agenda-group__days">
                {dates.map((date) => (
                  <div key={date}>
                    <p className="trip-agenda-group__date">{formatDisplayDate(date)}</p>
                    <TripAgendaList items={sorted.filter((item) => item.date === date)} onDate={date} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
