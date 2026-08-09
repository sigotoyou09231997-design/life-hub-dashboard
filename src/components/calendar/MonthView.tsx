import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameMonth,
  isToday,
  format,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMonthTitle, toDateStr } from "../../lib/date";

interface Props {
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  /** Dates with at least one calendar event — shown as a blue dot. */
  eventDates: Set<string>;
  /** Dates with at least one task due — shown as an orange dot. These are
   * fixed type markers, independent of each item's own category color
   * (which only appears in detail/list Badges). */
  taskDates: Set<string>;
}

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

export function MonthView({
  currentMonth,
  onMonthChange,
  selectedDate,
  onSelectDate,
  eventDates,
  taskDates,
}: Props) {
  const gridStart = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => onMonthChange(subMonths(currentMonth, 1))}
          className="rounded-full p-2 text-slate-400 active:bg-slate-100"
          aria-label="前の月"
        >
          <ChevronLeft size={20} />
        </button>
        <p className="text-sm font-semibold text-slate-900">{formatMonthTitle(currentMonth)}</p>
        <button
          onClick={() => onMonthChange(addMonths(currentMonth, 1))}
          className="rounded-full p-2 text-slate-400 active:bg-slate-100"
          aria-label="次の月"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-xs text-slate-400">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="py-1.5">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {days.map((day) => {
          const dateStr = toDateStr(day);
          const inMonth = isSameMonth(day, currentMonth);
          const selected = dateStr === selectedDate;
          const hasEvent = eventDates.has(dateStr);
          const hasTask = taskDates.has(dateStr);

          return (
            <button
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              className="flex flex-col items-center gap-0.5 py-1"
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors ${
                  selected
                    ? "bg-accent text-white font-semibold"
                    : isToday(day)
                      ? "text-accent font-semibold"
                      : inMonth
                        ? "text-slate-700"
                        : "text-slate-300"
                }`}
              >
                {format(day, "d")}
              </span>
              <span className="flex h-1.5 items-center gap-0.5">
                <span className={`h-1 w-1 rounded-full ${hasEvent ? "bg-accent" : "bg-transparent"}`} />
                <span className={`h-1 w-1 rounded-full ${hasTask ? "bg-warning" : "bg-transparent"}`} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
