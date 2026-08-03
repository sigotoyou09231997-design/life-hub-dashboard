import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import { todayStr } from "../../lib/date";
import { Card } from "../ui/Card";
import { ChevronRight, Clock } from "lucide-react";

export function TodayScheduleCard() {
  const today = todayStr();
  const events = useLiveQuery(() => db.calendarEvents.where("date").equals(today).toArray(), [today]);
  const sorted = [...(events ?? [])].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));

  return (
    <Link to="/calendar">
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-600">今日の予定</p>
          <ChevronRight size={18} className="text-slate-300" />
        </div>
        {sorted.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">予定はありません</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {sorted.slice(0, 3).map((ev) => (
              <div key={ev.id} className="flex items-center gap-2 text-sm text-slate-700">
                {ev.startTime && (
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <Clock size={12} />
                    {ev.startTime}
                  </span>
                )}
                <span className="truncate">{ev.title}</span>
              </div>
            ))}
            {sorted.length > 3 && <p className="text-xs text-slate-400">他{sorted.length - 3}件</p>}
          </div>
        )}
      </Card>
    </Link>
  );
}
