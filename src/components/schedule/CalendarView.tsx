import { startOfMonth, endOfMonth, startOfWeek, endOfWeek } from "date-fns";
import type { CalendarEvent, Task } from "../../types";
import { formatDisplayDate, toDateStr } from "../../lib/date";
import { collectSpanDates, collectSpanDatesInRange, occurringOn } from "../../lib/eventSpan";
import { getHolidayMapForYear } from "../../lib/holidays";
import { MonthView } from "../calendar/MonthView";
import { EventList } from "../calendar/EventList";
import { TaskItem } from "../tasks/TaskItem";
import { toggleTaskCompletion, deleteTaskCascade } from "../tasks/TaskList";
import { TripAgendaList, type TripAgendaEntry } from "./TripAgendaList";
import { Card } from "../ui/Card";

interface Props {
  events: CalendarEvent[];
  tasks: Task[];
  tripAgenda: TripAgendaEntry[];
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onEditEvent: (e: CalendarEvent) => void;
  onDeleteEvent: (id: string) => void;
  onEditTask: (t: Task) => void;
  onAddSubtask: (parentId: string) => void;
}

export function CalendarView({
  events,
  tasks,
  tripAgenda,
  currentMonth,
  onMonthChange,
  selectedDate,
  onSelectDate,
  onEditEvent,
  onDeleteEvent,
  onEditTask,
  onAddSubtask,
}: Props) {
  // 点は「かかっている日すべて」に打つ。初日にしか打たないと、宿泊の2日目は
  // カレンダー上では空いている日に見えてしまう。繰り返し予定は、表示中の月の枠
  // (MonthViewが描く週の並びと同じ範囲)ぶんだけ将来の回も展開する。
  const gridStart = toDateStr(startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }));
  const gridEnd = toDateStr(endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 }));
  const eventDates = collectSpanDatesInRange(events, gridStart, gridEnd);
  const taskDates = new Set(tasks.filter((t) => !t.completed && t.dueDate).map((t) => t.dueDate!));
  const tripDates = collectSpanDates(tripAgenda);

  const dayEvents = occurringOn(events, selectedDate);
  const dayTasks = tasks.filter((t) => t.dueDate === selectedDate && !t.parentTaskId);
  const dayTripAgenda = occurringOn(tripAgenda, selectedDate);
  const selectedHoliday = getHolidayMapForYear(Number(selectedDate.slice(0, 4))).get(selectedDate);

  return (
    <div className="calendar-workspace grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(330px,.5fr)]">
      <Card className="calendar-workspace__month p-4 lg:p-6">
        <MonthView
          currentMonth={currentMonth}
          onMonthChange={onMonthChange}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          eventDates={eventDates}
          taskDates={taskDates}
          tripDates={tripDates}
        />
      </Card>

      <Card className="calendar-workspace__detail space-y-5 p-5 lg:p-6">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <p className="calendar-detail-date text-sm font-medium text-slate-600">{formatDisplayDate(selectedDate)}の予定</p>
            {selectedHoliday && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-500">
                {selectedHoliday}
              </span>
            )}
          </div>
          <EventList events={dayEvents} onEdit={onEditEvent} onDelete={onDeleteEvent} onDate={selectedDate} />
        </div>

        {dayTripAgenda.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-600">{formatDisplayDate(selectedDate)}の旅行の予定</p>
            <TripAgendaList items={dayTripAgenda} onDate={selectedDate} />
          </div>
        )}

        <div>
          <p className="mb-2 text-sm font-medium text-slate-600">{formatDisplayDate(selectedDate)}のタスク</p>
          {dayTasks.length === 0 ? (
            <p className="calendar-compact-empty py-4 text-sm text-slate-500">タスクはありません</p>
          ) : (
            <div className="space-y-2">
              {dayTasks.map((t) => (
                <TaskItem
                  key={t.id}
                  task={t}
                  allTasks={tasks}
                  onToggle={toggleTaskCompletion}
                  onEdit={onEditTask}
                  onDelete={deleteTaskCascade}
                  onAddSubtask={onAddSubtask}
                />
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
