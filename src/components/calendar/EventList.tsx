import type { CalendarEvent } from "../../types";
import { CalendarClock, Clock, MapPin, Trash2 } from "lucide-react";
import { Badge } from "../ui/Badge";
import { ListRow } from "../ui/ListRow";
import { EmptyState } from "../ui/EmptyState";
import { getScheduleCategory } from "../../lib/scheduleCategories";

interface Props {
  events: CalendarEvent[];
  onEdit: (e: CalendarEvent) => void;
  onDelete: (id: string) => void;
  emptyMessage?: string;
}

export function EventList({ events, onEdit, onDelete, emptyMessage = "予定はありません" }: Props) {
  if (events.length === 0) {
    return <EmptyState icon={CalendarClock} title={emptyMessage} />;
  }

  const sorted = [...events].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });

  return (
    <div className="space-y-2">
      {sorted.map((ev) => {
        const category = getScheduleCategory(ev.category);
        return (
          <ListRow key={ev.id} interactive className="p-0">
            <button
              type="button"
              onClick={() => onEdit(ev)}
              aria-label={`${ev.title}を編集`}
              className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            />
            <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-medium text-slate-900" title={ev.title}>
                  {ev.title}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    {ev.allDay ? "終日" : ev.startTime ? `${ev.startTime}${ev.endTime ? `〜${ev.endTime}` : ""}` : "時刻未設定"}
                  </span>
                  {ev.location && (
                    <span className="flex items-center gap-1">
                      <MapPin size={12} />
                      {ev.location}
                    </span>
                  )}
                </div>
                <div className="mt-1.5">
                  <Badge tone={category.tone}>{category.label}</Badge>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (ev.id && confirm(`「${ev.title}」を削除しますか?`)) onDelete(ev.id);
                }}
                aria-label="削除"
                className="pointer-events-auto shrink-0 rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </ListRow>
        );
      })}
    </div>
  );
}
