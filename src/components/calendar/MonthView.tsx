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
import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMonthTitle, toDateStr } from "../../lib/date";
import { getHolidayMapForYears } from "../../lib/holidays";

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
  /** Dates with at least one trip schedule item — shown as a trip-orange dot,
   * fixed to the trips area's own identity color regardless of the current
   * screen's accent, so it reads as "trip data" wherever it shows up. */
  tripDates?: Set<string>;
  /** Dates before this (YYYY-MM-DD) render unselectable — e.g. a constraint the
   * AI found stated in an email ("8月17日以降で") that a manually-picked
   * replacement date shouldn't be able to violate. */
  minDate?: string;
}

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

export function MonthView({
  currentMonth,
  onMonthChange,
  selectedDate,
  onSelectDate,
  eventDates,
  taskDates,
  tripDates,
  minDate,
}: Props) {
  const gridStart = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const holidayMap = useMemo(
    () => getHolidayMapForYears([gridStart.getFullYear(), gridEnd.getFullYear()]),
    [gridStart, gridEnd],
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => onMonthChange(subMonths(currentMonth, 1))}
          className="rounded-full p-2 text-slate-400 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          aria-label="前の月"
        >
          <ChevronLeft size={20} />
        </button>
        <p className="text-sm font-semibold text-slate-900">{formatMonthTitle(currentMonth)}</p>
        <button
          onClick={() => onMonthChange(addMonths(currentMonth, 1))}
          className="rounded-full p-2 text-slate-400 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
          const hasTrip = tripDates?.has(dateStr) ?? false;
          const holidayName = holidayMap.get(dateStr);
          const disabled = Boolean(minDate) && dateStr < minDate!;

          return (
            <button
              key={dateStr}
              onClick={() => !disabled && onSelectDate(dateStr)}
              disabled={disabled}
              title={disabled ? `${minDate}以降のみ選択できます` : holidayName}
              className="flex flex-col items-center gap-0.5 py-1 disabled:cursor-not-allowed"
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors ${
                  disabled
                    ? "text-slate-200"
                    : selected
                      ? "bg-accent text-white font-semibold"
                      : isToday(day)
                        ? "text-accent font-semibold"
                        : holidayName && inMonth
                          ? "text-red-500 font-semibold"
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
                <span className={`h-1 w-1 rounded-full ${hasTrip ? "bg-[#ea580c]" : "bg-transparent"}`} />
              </span>
              <span className="block h-[28px] w-full overflow-hidden px-0.5 text-center text-[10px] font-semibold leading-[13px] text-red-500">
                {inMonth && holidayName ? holidayName : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
