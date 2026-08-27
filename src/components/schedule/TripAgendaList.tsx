import { Link } from "react-router-dom";
import { Plane, Clock, CalendarRange } from "lucide-react";
import { ListRow } from "../ui/ListRow";
import { spanLabel, spanTimeText } from "../../lib/eventSpan";

export interface TripAgendaEntry {
  id: string;
  tripId: string;
  tripName: string;
  date: string;
  /** 終了日(その日を含む)。宿泊のように何日かにまたがる日程にだけ入る。 */
  endDate?: string;
  startTime?: string;
  endTime?: string;
  title: string;
  location?: string;
}

interface Props {
  items: TripAgendaEntry[];
  /** 「その日」を見ている一覧では、その日付。またがる日程に「2日目/3日」と出せる。 */
  onDate?: string;
}

/** Read-only agenda rows for trip schedule items surfaced on the main Schedule page —
 * editing still happens on the trip's own 日程 tab, so these just link there. */
export function TripAgendaList({ items, onDate }: Props) {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));

  return (
    <div className="space-y-2">
      {sorted.map((item) => (
        <Link
          key={item.id}
          to={`/trips/${item.tripId}?tab=schedule`}
          className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ea580c]/50"
        >
          <ListRow interactive className="flex items-center gap-3 border-orange-100 bg-orange-50/50">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600">
              <Plane size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 text-sm font-medium text-slate-900" title={item.title}>
                {item.title}
              </p>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                {(item.startTime || item.endDate) && (
                  <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap">
                    <Clock size={11} />
                    {spanTimeText(item, onDate)}
                  </span>
                )}
                {spanLabel(item, onDate) && (
                  <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap font-medium text-slate-500">
                    <CalendarRange size={11} />
                    {spanLabel(item, onDate)}
                  </span>
                )}
                <span className="truncate">{item.tripName}</span>
              </div>
            </div>
          </ListRow>
        </Link>
      ))}
    </div>
  );
}
