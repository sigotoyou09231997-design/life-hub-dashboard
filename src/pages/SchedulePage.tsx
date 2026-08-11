import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Calendar as CalendarIcon, CheckSquare } from "lucide-react";
import { db } from "../db/schema";
import type { CalendarEvent, Task } from "../types";
import { todayStr } from "../lib/date";
import { AREA_ACCENT_STYLE } from "../lib/areaColors";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { Tabs } from "../components/ui/Tabs";
import { EventForm } from "../components/calendar/EventForm";
import { TaskForm } from "../components/tasks/TaskForm";
import { TodayView } from "../components/schedule/TodayView";
import { CalendarView } from "../components/schedule/CalendarView";
import { ListView } from "../components/schedule/ListView";
import type { TripAgendaEntry } from "../components/schedule/TripAgendaList";
import { useToast } from "../components/ui/ToastProvider";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { useDelayedFlag } from "../hooks/useDelayedFlag";

type Tab = "today" | "calendar" | "list";
type EditingEvent = CalendarEvent | "new" | null;
type EditingTask =
  | { mode: "new" }
  | { mode: "edit"; task: Task }
  | { mode: "subtask"; parentId: number }
  | null;

export default function SchedulePage() {
  const showToast = useToast();
  const [tab, setTab] = useState<Tab>("today");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EditingEvent>(null);
  const [editingTask, setEditingTask] = useState<EditingTask>(null);

  const eventsResult = useLiveQuery(() => db.calendarEvents.toArray(), []);
  const tasksResult = useLiveQuery(() => db.tasks.toArray(), []);
  const tripScheduleResult = useLiveQuery(() => db.tripSchedule.toArray(), []);
  const tripsResult = useLiveQuery(() => db.trips.toArray(), []);
  const events = eventsResult ?? [];
  const tasks = tasksResult ?? [];
  const showSkeleton = useDelayedFlag(eventsResult === undefined || tasksResult === undefined);

  const tripNameById = new Map((tripsResult ?? []).map((t) => [t.id, t.name]));
  const tripAgenda: TripAgendaEntry[] = (tripScheduleResult ?? []).map((s) => ({
    id: s.id!,
    tripId: s.tripId,
    tripName: tripNameById.get(s.tripId) ?? "旅行",
    date: s.date,
    startTime: s.startTime,
    title: s.title,
    location: s.location,
  }));

  const addDefaultDate = tab === "calendar" ? selectedDate : todayStr();

  function handleEditTask(task: Task) {
    setEditingTask({ mode: "edit", task });
  }
  function handleAddSubtask(parentId: number) {
    setEditingTask({ mode: "subtask", parentId });
  }
  function handleDeleteEvent(id: number) {
    db.calendarEvents.delete(id);
    showToast("削除しました");
  }

  return (
    <div className="pb-10" style={AREA_ACCENT_STYLE.schedule}>
      <PageHeader
        title="予定・タスク管理"
        backTo="/"
        right={
          <button
            onClick={() => setAddTypeOpen(true)}
            aria-label="予定・タスクを追加"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white shadow-sm transition-colors active:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <Plus size={20} />
          </button>
        }
      />

      <div className="mx-5 mb-4">
        <Tabs
          options={[
            { value: "today", label: "今日" },
            { value: "calendar", label: "カレンダー" },
            { value: "list", label: "一覧" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      <div className="px-5">
        {showSkeleton ? (
          <ListSkeleton />
        ) : (
          <>
        {tab === "today" && (
          <TodayView
            events={events}
            tasks={tasks}
            tripAgenda={tripAgenda}
            onEditEvent={(e) => setEditingEvent(e)}
            onDeleteEvent={handleDeleteEvent}
            onEditTask={handleEditTask}
            onAddSubtask={handleAddSubtask}
          />
        )}

        {tab === "calendar" && (
          <CalendarView
            events={events}
            tasks={tasks}
            tripAgenda={tripAgenda}
            currentMonth={currentMonth}
            onMonthChange={setCurrentMonth}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onEditEvent={(e) => setEditingEvent(e)}
            onDeleteEvent={handleDeleteEvent}
            onEditTask={handleEditTask}
            onAddSubtask={handleAddSubtask}
          />
        )}

        {tab === "list" && (
          <ListView
            events={events}
            tasks={tasks}
            tripAgenda={tripAgenda}
            onEditEvent={(e) => setEditingEvent(e)}
            onDeleteEvent={handleDeleteEvent}
            onEditTask={handleEditTask}
            onAddSubtask={handleAddSubtask}
          />
        )}
          </>
        )}
      </div>

      <Sheet open={addTypeOpen} onClose={() => setAddTypeOpen(false)} title="何を追加しますか?">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => {
              setAddTypeOpen(false);
              setEditingEvent("new");
            }}
            className="flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 py-5 active:bg-slate-100"
          >
            <CalendarIcon size={24} className="text-accent" />
            <span className="text-sm font-medium text-slate-700">予定</span>
          </button>
          <button
            onClick={() => {
              setAddTypeOpen(false);
              setEditingTask({ mode: "new" });
            }}
            className="flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 py-5 active:bg-slate-100"
          >
            <CheckSquare size={24} className="text-accent" />
            <span className="text-sm font-medium text-slate-700">タスク</span>
          </button>
        </div>
      </Sheet>

      <Sheet
        open={editingEvent !== null}
        onClose={() => setEditingEvent(null)}
        title={editingEvent === "new" ? "予定を追加" : "予定を編集"}
      >
        {editingEvent && (
          <EventForm
            initial={editingEvent === "new" ? undefined : editingEvent}
            defaultDate={addDefaultDate}
            onSaved={() => {
              setEditingEvent(null);
              showToast("保存しました");
            }}
            onCancel={() => setEditingEvent(null)}
          />
        )}
      </Sheet>

      <Sheet
        open={editingTask !== null}
        onClose={() => setEditingTask(null)}
        title={
          editingTask?.mode === "edit" ? "タスクを編集" : editingTask?.mode === "subtask" ? "サブタスクを追加" : "タスクを追加"
        }
      >
        {editingTask && (
          <TaskForm
            initial={editingTask.mode === "edit" ? editingTask.task : undefined}
            parentTaskId={editingTask.mode === "subtask" ? editingTask.parentId : undefined}
            onSaved={() => {
              setEditingTask(null);
              showToast("保存しました");
            }}
            onCancel={() => setEditingTask(null)}
          />
        )}
      </Sheet>
    </div>
  );
}
