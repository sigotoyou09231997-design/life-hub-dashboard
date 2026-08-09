import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Calendar as CalendarIcon, CheckSquare } from "lucide-react";
import { db } from "../db/schema";
import type { CalendarEvent, Task } from "../types";
import { todayStr } from "../lib/date";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { EventForm } from "../components/calendar/EventForm";
import { TaskForm } from "../components/tasks/TaskForm";
import { TodayView } from "../components/schedule/TodayView";
import { CalendarView } from "../components/schedule/CalendarView";
import { ListView } from "../components/schedule/ListView";

type Tab = "today" | "calendar" | "list";
type EditingEvent = CalendarEvent | "new" | null;
type EditingTask =
  | { mode: "new" }
  | { mode: "edit"; task: Task }
  | { mode: "subtask"; parentId: number }
  | null;

export default function SchedulePage() {
  const [tab, setTab] = useState<Tab>("today");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EditingEvent>(null);
  const [editingTask, setEditingTask] = useState<EditingTask>(null);

  const events = useLiveQuery(() => db.calendarEvents.toArray(), []) ?? [];
  const tasks = useLiveQuery(() => db.tasks.toArray(), []) ?? [];

  const addDefaultDate = tab === "calendar" ? selectedDate : todayStr();

  function handleEditTask(task: Task) {
    setEditingTask({ mode: "edit", task });
  }
  function handleAddSubtask(parentId: number) {
    setEditingTask({ mode: "subtask", parentId });
  }
  function handleDeleteEvent(id: number) {
    db.calendarEvents.delete(id);
  }

  return (
    <div className="pb-10">
      <PageHeader
        title="予定・タスク管理"
        backTo="/"
        right={
          <button
            onClick={() => setAddTypeOpen(true)}
            aria-label="追加"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white active:bg-accent/90"
          >
            <Plus size={20} />
          </button>
        }
      />

      <div className="mx-5 mb-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {([
          ["today", "今日"],
          ["calendar", "カレンダー"],
          ["list", "一覧"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === key ? "bg-white text-accent shadow-sm" : "text-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="px-5">
        {tab === "today" && (
          <TodayView
            events={events}
            tasks={tasks}
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
            onEditEvent={(e) => setEditingEvent(e)}
            onDeleteEvent={handleDeleteEvent}
            onEditTask={handleEditTask}
            onAddSubtask={handleAddSubtask}
          />
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
            onSaved={() => setEditingEvent(null)}
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
            onSaved={() => setEditingTask(null)}
            onCancel={() => setEditingTask(null)}
          />
        )}
      </Sheet>
    </div>
  );
}
