import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import type { CalendarEvent } from "../types";
import { todayStr, formatDisplayDate } from "../lib/date";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { MonthView } from "../components/calendar/MonthView";
import { WeekView } from "../components/calendar/WeekView";
import { EventForm } from "../components/calendar/EventForm";
import { EventList } from "../components/calendar/EventList";

type ViewMode = "month" | "week";

export default function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | "new" | null>(null);

  const allEvents = useLiveQuery(() => db.calendarEvents.toArray(), []);
  const markedDates = new Set((allEvents ?? []).map((e) => e.date));
  const dayEvents = (allEvents ?? []).filter((e) => e.date === selectedDate);

  return (
    <div className="pb-10">
      <PageHeader title="カレンダー" backTo="/schedule" />

      <div className="px-5">
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
          {(["month", "week"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                viewMode === mode ? "bg-white text-accent shadow-sm" : "text-slate-500"
              }`}
            >
              {mode === "month" ? "月表示" : "週表示"}
            </button>
          ))}
        </div>

        {viewMode === "month" ? (
          <MonthView
            currentMonth={currentMonth}
            onMonthChange={setCurrentMonth}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            markedDates={markedDates}
          />
        ) : (
          <WeekView selectedDate={selectedDate} onSelectDate={setSelectedDate} markedDates={markedDates} />
        )}

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-600">{formatDisplayDate(selectedDate)}の予定</p>
            <button onClick={() => setEditingEvent("new")} className="text-sm font-medium text-accent">
              + 予定を追加
            </button>
          </div>
          <EventList
            events={dayEvents}
            onEdit={(e) => setEditingEvent(e)}
            onDelete={(id) => db.calendarEvents.delete(id)}
          />
        </div>
      </div>

      <Sheet
        open={editingEvent !== null}
        onClose={() => setEditingEvent(null)}
        title={editingEvent === "new" ? "予定を追加" : "予定を編集"}
      >
        {editingEvent && (
          <EventForm
            initial={editingEvent === "new" ? undefined : editingEvent}
            defaultDate={selectedDate}
            onSaved={() => setEditingEvent(null)}
            onCancel={() => setEditingEvent(null)}
          />
        )}
      </Sheet>
    </div>
  );
}
