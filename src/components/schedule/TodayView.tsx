import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { CheckSquare } from "lucide-react";
import type { CalendarEvent, Task } from "../../types";
import { todayStr, isOverdue } from "../../lib/date";
import { EventList } from "../calendar/EventList";
import { TaskItem } from "../tasks/TaskItem";
import { toggleTaskCompletion, deleteTaskCascade } from "../tasks/TaskList";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { TripAgendaList, type TripAgendaEntry } from "./TripAgendaList";

interface Props {
  events: CalendarEvent[];
  tasks: Task[];
  tripAgenda: TripAgendaEntry[];
  onEditEvent: (e: CalendarEvent) => void;
  onDeleteEvent: (id: string) => void;
  onEditTask: (t: Task) => void;
  onAddSubtask: (parentId: string) => void;
}

export function TodayView({ events, tasks, tripAgenda, onEditEvent, onDeleteEvent, onEditTask, onAddSubtask }: Props) {
  const today = todayStr();
  const todayEvents = events.filter((e) => e.date === today);
  const todayTripAgenda = tripAgenda.filter((t) => t.date === today);

  const incompleteTopLevel = tasks.filter((t) => !t.completed && !t.parentTaskId);
  // A due-today task whose time has already passed counts as overdue, not
  // "today" — the two groups are mutually exclusive.
  const overdueTasks = incompleteTopLevel.filter((t) => isOverdue(t.dueDate, t.dueTime));
  const dueTodayTasks = incompleteTopLevel.filter(
    (t) => t.dueDate === today && !isOverdue(t.dueDate, t.dueTime),
  );

  return (
    <div className="space-y-6">
      {/* Paired as a 2-up grid at lg+ (1 column below) so an empty day never
          shows as a bare EmptyState sitting directly on the page background —
          both sections are always inside their own glass card with a
          min-height, matching the density of a populated day. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex min-h-[220px] flex-col">
          <p className="mb-2 text-sm font-medium text-slate-600">{format(new Date(), "M月d日(E)", { locale: ja })}の予定</p>
          <div className="flex flex-1 flex-col justify-center">
            <EventList events={todayEvents} onEdit={onEditEvent} onDelete={onDeleteEvent} emptyMessage="今日の予定はありません" />
          </div>
        </Card>

        <Card className="flex min-h-[220px] flex-col">
          <p className="mb-2 text-sm font-medium text-slate-600">今日のタスク</p>
          <div className="flex flex-1 flex-col justify-center">
            {dueTodayTasks.length === 0 ? (
              <EmptyState icon={CheckSquare} title="今日期限のタスクはありません" />
            ) : (
              <div className="space-y-2">
                {dueTodayTasks.map((t) => (
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

      {todayTripAgenda.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-600">今日の旅行の予定</p>
          <TripAgendaList items={todayTripAgenda} />
        </div>
      )}

      {overdueTasks.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-danger">期限切れのタスク</p>
          <div className="space-y-2">
            {overdueTasks.map((t) => (
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
        </div>
      )}
    </div>
  );
}
