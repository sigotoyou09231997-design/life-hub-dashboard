import type { CalendarEvent, Task } from "../../types";
import { formatDisplayDate } from "../../lib/date";
import { MonthView } from "../calendar/MonthView";
import { EventList } from "../calendar/EventList";
import { TaskItem } from "../tasks/TaskItem";
import { toggleTaskCompletion, deleteTaskCascade } from "../tasks/TaskList";

interface Props {
  events: CalendarEvent[];
  tasks: Task[];
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onEditEvent: (e: CalendarEvent) => void;
  onDeleteEvent: (id: number) => void;
  onEditTask: (t: Task) => void;
  onAddSubtask: (parentId: number) => void;
}

export function CalendarView({
  events,
  tasks,
  currentMonth,
  onMonthChange,
  selectedDate,
  onSelectDate,
  onEditEvent,
  onDeleteEvent,
  onEditTask,
  onAddSubtask,
}: Props) {
  const eventDates = new Set(events.map((e) => e.date));
  const taskDates = new Set(tasks.filter((t) => !t.completed && t.dueDate).map((t) => t.dueDate!));

  const dayEvents = events.filter((e) => e.date === selectedDate);
  const dayTasks = tasks.filter((t) => t.dueDate === selectedDate && !t.parentTaskId);

  return (
    <div>
      <MonthView
        currentMonth={currentMonth}
        onMonthChange={onMonthChange}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        eventDates={eventDates}
        taskDates={taskDates}
      />

      <div className="mt-6 space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium text-slate-600">{formatDisplayDate(selectedDate)}の予定</p>
          <EventList events={dayEvents} onEdit={onEditEvent} onDelete={onDeleteEvent} />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-600">{formatDisplayDate(selectedDate)}のタスク</p>
          {dayTasks.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">タスクはありません</p>
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
      </div>
    </div>
  );
}
