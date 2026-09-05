import { useState } from "react";
import { format } from "date-fns";
import { Search } from "lucide-react";
import type { CalendarEvent, Task, Priority } from "../../types";
import { todayStr } from "../../lib/date";
import { nextOccurrenceOnOrAfter, spanEndDate } from "../../lib/eventSpan";
import { EventList } from "../calendar/EventList";
import { TaskList } from "../tasks/TaskList";
import { Tabs } from "../ui/Tabs";
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

type TypeFilter = "all" | "event" | "task";
type PriorityFilter = "all" | Priority;

const PRIORITY_LABEL: Record<Priority, string> = { high: "高", medium: "中", low: "低" };

function isUpcomingOrOngoing(event: CalendarEvent, today: string, nowHM: string): boolean {
  // 繰り返し予定は、最初の回がとっくに終わっていても次の回が控えている限り「今後」扱い。
  if (event.repeat && event.repeat !== "none" && (!event.repeatUntil || event.repeatUntil >= today)) return true;
  if (event.date > today) return true;
  // 何日かにまたがる予定は、始まった日ではなく終わる日で切る。初日で切っていた頃の
  // ままだと、今まさに泊まっている宿泊が「今後の予定」から消えてしまう。
  const lastDay = spanEndDate(event);
  if (lastDay < today) return false;
  if (lastDay > today) return true;
  if (event.allDay) return true;
  const endRef = event.endTime ?? event.startTime;
  if (!endRef) return true;
  return endRef >= nowHM;
}

export function ListView({ events, tasks, tripAgenda, onEditEvent, onDeleteEvent, onEditTask, onAddSubtask }: Props) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [query, setQuery] = useState("");

  const today = todayStr();
  const nowHM = format(new Date(), "HH:mm");
  const q = query.trim().toLowerCase();
  const matchesQuery = (...texts: (string | undefined)[]) => !q || texts.some((t) => (t ?? "").toLowerCase().includes(q));

  // 繰り返し予定は元の開始日ではなく、次に来る回の日付で並べる — でないと、ずっと前に
  // 始まった「毎週」の予定が一覧の一番上に居座ってしまう。
  const sortKey = (e: CalendarEvent) => nextOccurrenceOnOrAfter(e, today) ?? e.date;
  const upcomingEvents = events
    .filter((e) => isUpcomingOrOngoing(e, today, nowHM))
    .filter((e) => matchesQuery(e.title, e.location, e.memo))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  const upcomingTripAgenda = tripAgenda
    .filter((t) => spanEndDate(t) >= today)
    .filter((t) => matchesQuery(t.title, t.location, t.tripName))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));

  const filteredTasks = (priorityFilter === "all" ? tasks : tasks.filter((t) => t.priority === priorityFilter)).filter((t) =>
    matchesQuery(t.title),
  );
  const taskEmptyMessage = tasks.length > 0 && filteredTasks.length === 0 ? "該当するタスクはありません" : undefined;

  return (
    <div className="planning-list-workspace space-y-5">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="予定・タスクを検索"
          className="field-shell w-full !pl-9"
        />
      </div>

      <Tabs
        options={[
          { value: "all", label: "すべて" },
          { value: "event", label: "予定" },
          { value: "task", label: "タスク" },
        ]}
        value={typeFilter}
        onChange={setTypeFilter}
      />

      {typeFilter === "task" && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="優先度フィルター">
          {(["all", "high", "medium", "low"] as PriorityFilter[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriorityFilter(p)}
              aria-pressed={priorityFilter === p}
              className={`rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                priorityFilter === p
                  ? "border-accent bg-accent-light font-semibold text-accent"
                  : "border-white/50 font-medium text-slate-500 hover:border-white/80"
              }`}
            >
              {p === "all" ? "すべての優先度" : `優先度: ${PRIORITY_LABEL[p]}`}
            </button>
          ))}
        </div>
      )}

      <div className="planning-list-columns grid gap-3 lg:grid-cols-2 lg:items-start">
        {(typeFilter === "all" || typeFilter === "event") && (
          <div className="planning-list-module space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-600">今後の予定</p>
              <EventList events={upcomingEvents} onEdit={onEditEvent} onDelete={onDeleteEvent} emptyMessage="今後の予定はありません" />
            </div>
            {upcomingTripAgenda.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium text-slate-600">今後の旅行の予定</p>
                <TripAgendaList items={upcomingTripAgenda} />
              </div>
            )}
          </div>
        )}

        {(typeFilter === "all" || typeFilter === "task") && (
          <div className={`planning-list-module ${typeFilter === "task" ? "lg:col-span-2" : ""}`}>
            <p className="mb-2 text-sm font-medium text-slate-600">タスク</p>
            <TaskList tasks={filteredTasks} onEdit={onEditTask} onAddSubtask={onAddSubtask} emptyMessage={taskEmptyMessage} />
          </div>
        )}
      </div>
    </div>
  );
}
