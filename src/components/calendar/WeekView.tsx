import { startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, isToday, format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { parseDate, toDateStr } from "../../lib/date";

interface Props {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  markedDates: Set<string>;
}

export function WeekView({ selectedDate, onSelectDate, markedDates }: Props) {
  const anchor = parseDate(selectedDate);
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(anchor, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => onSelectDate(toDateStr(subWeeks(anchor, 1)))}
          className="rounded-full p-2 text-slate-400 active:bg-slate-100"
          aria-label="前の週"
        >
          <ChevronLeft size={20} />
        </button>
        <p className="text-sm font-semibold text-slate-900">
          {format(weekStart, "M月d日")} - {format(weekEnd, "M月d日")}
        </p>
        <button
          onClick={() => onSelectDate(toDateStr(addWeeks(anchor, 1)))}
          className="rounded-full p-2 text-slate-400 active:bg-slate-100"
          aria-label="次の週"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const dateStr = toDateStr(day);
          const selected = dateStr === selectedDate;
          const marked = markedDates.has(dateStr);

          return (
            <button
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              className="flex flex-col items-center gap-1 rounded-xl py-2"
            >
              <span className="text-[11px] text-slate-400">{format(day, "E")}</span>
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm transition-colors ${
                  selected
                    ? "bg-accent text-white font-semibold"
                    : isToday(day)
                      ? "text-accent font-semibold"
                      : "text-slate-700"
                }`}
              >
                {format(day, "d")}
              </span>
              <span className={`h-1 w-1 rounded-full ${marked ? "bg-accent" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
