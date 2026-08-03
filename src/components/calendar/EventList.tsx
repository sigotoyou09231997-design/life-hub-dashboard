import type { CalendarEvent } from "../../types";
import { Clock, MapPin, Trash2 } from "lucide-react";

interface Props {
  events: CalendarEvent[];
  onEdit: (e: CalendarEvent) => void;
  onDelete: (id: number) => void;
  emptyMessage?: string;
}

export function EventList({ events, onEdit, onDelete, emptyMessage = "予定はありません" }: Props) {
  if (events.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">{emptyMessage}</p>;
  }

  const sorted = [...events].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));

  return (
    <div className="space-y-2">
      {sorted.map((ev) => (
        <div
          key={ev.id}
          onClick={() => onEdit(ev)}
          className="flex items-start justify-between rounded-xl border border-slate-100 bg-white p-3.5 active:bg-slate-50"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{ev.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              {ev.startTime && (
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {ev.startTime}
                  {ev.endTime ? `〜${ev.endTime}` : ""}
                </span>
              )}
              {ev.location && (
                <span className="flex items-center gap-1">
                  <MapPin size={12} />
                  {ev.location}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (ev.id) onDelete(ev.id);
            }}
            aria-label="削除"
            className="shrink-0 rounded-full p-1.5 text-slate-300 active:bg-red-50 active:text-danger"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
