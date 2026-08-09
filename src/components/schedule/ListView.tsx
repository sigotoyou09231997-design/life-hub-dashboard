import { useState } from "react";
import { format } from "date-fns";
import type { CalendarEvent, Task, Priority } from "../../types";
import { todayStr } from "../../lib/date";
import { EventList } from "../calendar/EventList";
import { TaskList } from "../tasks/TaskList";

interface Props {
  events: CalendarEvent[];
  tasks: Task[];
  onEditEvent: (e: CalendarEvent) => void;
  onDeleteEvent: (id: number) => void;
  onEditTask: (t: Task) => void;
  onAddSubtask: (parentId: number) => void;
}

type TypeFilter = "all" | "event" | "task";
type PriorityFilter = "all" | Priority;

const PRIORITY_LABEL: Record<Priority, string> = { high: "高", medium: "中", low: "低" };

function isUpcomingOrOngoing(event: CalendarEvent, today: string, nowHM: string): boolean {
  if (event.date > today) return true;
  if (event.date < today) return false;
  if (event.allDay) return true;
  const endRef = event.endTime ?? event.startTime;
  if (!endRef) return true;
  return endRef >= nowHM;
}

export function ListView({ events, tasks, onEditEvent, onDeleteEvent, onEditTask, onAddSubtask }: Props) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");

  const today = todayStr();
  const nowHM = format(new Date(), "HH:mm");

  const upcomingEvents = events
    .filter((e) => isUpcomingOrOngoing(e, today, nowHM))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));

  const filteredTasks = priorityFilter === "all" ? tasks : tasks.filter((t) => t.priority === priorityFilter);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {([
          ["all", "すべて"],
          ["event", "予定"],
          ["task", "タスク"],
        ] as [TypeFilter, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTypeFilter(key)}
            className={`rounded-lg py-2 text-xs font-medium transition-colors ${
              typeFilter === key ? "bg-white text-accent shadow-sm" : "text-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {typeFilter === "task" && (
        <div className="flex flex-wrap gap-1.5">
          {(["all", "high", "medium", "low"] as PriorityFilter[]).map((p) => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                priorityFilter === p
                  ? "border-accent bg-accent-light text-accent"
                  : "border-slate-200 text-slate-500"
              }`}
            >
              {p === "all" ? "すべての優先度" : `優先度: ${PRIORITY_LABEL[p]}`}
            </button>
          ))}
        </div>
      )}

      {(typeFilter === "all" || typeFilter === "event") && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-600">今後の予定</p>
          <EventList events={upcomingEvents} onEdit={onEditEvent} onDelete={onDeleteEvent} emptyMessage="今後の予定はありません" />
        </div>
      )}

      {(typeFilter === "all" || typeFilter === "task") && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-600">タスク</p>
          <TaskList tasks={filteredTasks} onEdit={onEditTask} onAddSubtask={onAddSubtask} />
        </div>
      )}
    </div>
  );
}
