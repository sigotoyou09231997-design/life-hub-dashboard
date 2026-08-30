import type { CSSProperties } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { CalendarDays, CheckSquare, Plus } from "lucide-react";
import type { CalendarEvent, Task } from "../../types";
import { todayStr, isOverdue } from "../../lib/date";
import { occurringOn } from "../../lib/eventSpan";
import { EventList } from "../calendar/EventList";
import { TaskItem } from "../tasks/TaskItem";
import { toggleTaskCompletion, deleteTaskCascade } from "../tasks/TaskList";
import { Card } from "../ui/Card";
import { TripAgendaList, type TripAgendaEntry } from "./TripAgendaList";

interface Props {
  events: CalendarEvent[];
  tasks: Task[];
  tripAgenda: TripAgendaEntry[];
  onEditEvent: (e: CalendarEvent) => void;
  onDeleteEvent: (id: string) => void;
  onEditTask: (t: Task) => void;
  onAddSubtask: (parentId: string) => void;
  onAddEvent: () => void;
  onAddTask: () => void;
}

export function TodayView({ events, tasks, tripAgenda, onEditEvent, onDeleteEvent, onEditTask, onAddSubtask, onAddEvent, onAddTask }: Props) {
  const today = todayStr();
  // またがる予定(宿泊など)は、初日だけでなくかかっている日すべてに出す。
  const todayEvents = occurringOn(events, today);
  const todayTripAgenda = occurringOn(tripAgenda, today);
  const incompleteTopLevel = tasks.filter((t) => !t.completed && !t.parentTaskId);
  const overdueTasks = incompleteTopLevel.filter((t) => isOverdue(t.dueDate, t.dueTime));
  const dueTodayTasks = incompleteTopLevel.filter((t) => t.dueDate === today && !isOverdue(t.dueDate, t.dueTime));
  const allDueTodayTasks = tasks.filter((t) => t.dueDate === today && !t.parentTaskId);
  const completedTodayCount = allDueTodayTasks.filter((t) => t.completed).length;
  const taskProgress = allDueTodayTasks.length ? Math.round((completedTodayCount / allDueTodayTasks.length) * 100) : 0;
  const now = new Date();
  const currentTimePosition = Math.max(0, Math.min(100, (((now.getHours() + now.getMinutes() / 60) - 6) / 18) * 100));

  // 予定もタスクも無い日は、2枚のカードだけで画面の半分も埋まらず、下に背景
  // だけの帯が残っていた。その日は下まで使い切る(.is-empty-fill、index.css)。
  const nothingToday =
    todayEvents.length === 0 && dueTodayTasks.length === 0 && todayTripAgenda.length === 0 && overdueTasks.length === 0;

  return (
    <div className={`planning-today space-y-5 ${nothingToday ? "is-empty-fill" : ""}`}>
      <div className="planning-today__grid grid gap-3 lg:grid-cols-12">
        <Card className="planning-timeline-module flex min-h-[250px] flex-col lg:col-span-7">
          <div className="planning-module-heading">
            <div><p>{format(now, "M月d日(E)", { locale: ja })}</p></div>
            <b>予定 {todayEvents.length}件</b>
          </div>
          <div className="planning-timeline-detail">
            <div className="planning-time-rail" aria-hidden="true">
              <span>6</span><span>12</span><span>18</span><span>24</span>
              <i style={{ top: `${currentTimePosition}%` }} />
            </div>
            <div className="planning-timeline-content">
              {todayEvents.length > 0 ? (
                <EventList events={todayEvents} onEdit={onEditEvent} onDelete={onDeleteEvent} onDate={today} />
              ) : (
                <div className="planning-empty-control planning-empty-control--timeline">
                  <div className="planning-compact-empty"><span className="planning-date-glyph">{format(now, "d")}</span><div><strong>静かな一日です</strong><p>次の予定はまだありません</p></div></div>
                  <div className="planning-empty-footer"><span><i />今日はまだ空いています</span><button type="button" onClick={onAddEvent}><Plus size={13} />予定を追加</button></div>
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card className="planning-task-module flex min-h-[250px] flex-col lg:col-span-5">
          <div className="planning-module-heading"><div><p>今日のタスク</p></div><b>{completedTodayCount} / {allDueTodayTasks.length}</b></div>
          <div className="planning-task-overview">
            <div className="planning-progress-ring" style={{ "--planning-progress": `${taskProgress * 3.6}deg` } as CSSProperties}><span>{taskProgress}<small>%</small></span></div>
            <div><strong>{allDueTodayTasks.length ? `あと${Math.max(0, allDueTodayTasks.length - completedTodayCount)}件` : "タスクなし"}</strong><p>完了 {completedTodayCount} / 全体 {allDueTodayTasks.length}</p></div>
          </div>
          <div className="planning-task-list">
            {dueTodayTasks.length === 0 ? (
              <div className="planning-empty-control planning-empty-control--tasks">
                <div className="planning-compact-empty"><CheckSquare size={18} /><div><strong>今日のタスクはありません</strong><p>やることは片づいています</p></div></div>
                <div className="planning-empty-footer"><span>未完了 0件</span><button type="button" onClick={onAddTask}><Plus size={13} />タスクを追加</button></div>
              </div>
            ) : (
              <div className="space-y-2">
                {dueTodayTasks.map((task) => (
                  <TaskItem key={task.id} task={task} allTasks={tasks} onToggle={toggleTaskCompletion} onEdit={onEditTask} onDelete={deleteTaskCascade} onAddSubtask={onAddSubtask} />
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {todayTripAgenda.length > 0 && (
        <section className="planning-secondary-module"><p><CalendarDays size={14} />今日の旅行予定</p><TripAgendaList items={todayTripAgenda} onDate={today} /></section>
      )}

      {overdueTasks.length > 0 && (
        <section className="planning-secondary-module planning-secondary-module--danger">
          <p>期限切れのタスク</p>
          <div className="space-y-2">{overdueTasks.map((task) => <TaskItem key={task.id} task={task} allTasks={tasks} onToggle={toggleTaskCompletion} onEdit={onEditTask} onDelete={deleteTaskCascade} onAddSubtask={onAddSubtask} />)}</div>
        </section>
      )}
    </div>
  );
}
