import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Calendar as CalendarIcon, CheckSquare } from "lucide-react";
import { db } from "../db/schema";
import type { CalendarEvent, JobApplication, Task } from "../types";
import { todayStr } from "../lib/date";
import { AREA_ACCENT_STYLE } from "../lib/areaColors";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { PageFab } from "../components/ui/PageFab";
import { Tabs } from "../components/ui/Tabs";
import { EventForm } from "../components/calendar/EventForm";
import { TaskForm } from "../components/tasks/TaskForm";
import { TodayView } from "../components/schedule/TodayView";
import { CalendarView } from "../components/schedule/CalendarView";
import { ListView } from "../components/schedule/ListView";
import { JobApplicationList } from "../components/jobs/JobApplicationList";
import { JobApplicationForm } from "../components/jobs/JobApplicationForm";
import type { TripAgendaEntry } from "../components/schedule/TripAgendaList";
import { useToast } from "../components/ui/ToastProvider";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { useDelayedFlag } from "../hooks/useDelayedFlag";

type Tab = "today" | "calendar" | "list" | "jobs";
type EditingEvent = CalendarEvent | "new" | null;
type EditingJob = JobApplication | "new" | null;
type EditingTask =
  | { mode: "new" }
  | { mode: "edit"; task: Task }
  | { mode: "subtask"; parentId: string }
  | null;

function tabFromView(view: string | null): Tab {
  if (view === "calendar") return "calendar";
  if (view === "list") return "list";
  if (view === "jobs") return "jobs";
  return "today";
}

export default function SchedulePage() {
  const showToast = useToast();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => tabFromView(searchParams.get("view")));

  // TopPage's 予定/タスク tiles and AppHeader's overdue-task notices link to
  // /schedule?view=... while this page may already be mounted (same route,
  // only the query changes) — re-sync the tab in that case rather than
  // relying solely on the initial state above.
  useEffect(() => {
    setTab(tabFromView(searchParams.get("view")));
  }, [searchParams]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EditingEvent>(null);
  const [editingTask, setEditingTask] = useState<EditingTask>(null);
  const [editingJob, setEditingJob] = useState<EditingJob>(null);

  const jobsResult = useLiveQuery(() => db.jobApplications.toArray(), []);
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
    endDate: s.endDate,
    startTime: s.startTime,
    endTime: s.endTime,
    title: s.title,
    location: s.location,
  }));

  const addDefaultDate = tab === "calendar" ? selectedDate : todayStr();

  function handleEditTask(task: Task) {
    setEditingTask({ mode: "edit", task });
  }
  function handleAddSubtask(parentId: string) {
    setEditingTask({ mode: "subtask", parentId });
  }
  function handleDeleteEvent(id: string) {
    db.calendarEvents.delete(id);
    showToast("削除しました");
  }
  function handleDeleteJob(application: JobApplication) {
    if (!application.id) return;
    if (!confirm(`「${application.companyName}」を削除します。よろしいですか?`)) return;
    // カレンダーへ入れた予定は消さない — 応募先の記録をやめても、その日に
    // 面接があった事実は予定表に残しておきたい(消したいなら予定の側で消せる)。
    db.jobApplications.delete(application.id);
    showToast("削除しました");
  }

  return (
    <div className="spatial-page planning-page micro-contrast pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.schedule}>
      <PageHeader title="予定・タスク管理" backTo="/" />

      <div className="spatial-page-tabs mx-5 mb-4 lg:mx-8 lg:mb-6 lg:max-w-[620px]">
        <Tabs
          options={[
            { value: "today", label: "今日" },
            { value: "calendar", label: "カレンダー" },
            { value: "list", label: "一覧" },
            { value: "jobs", label: "就活" },
          ]}
          value={tab}
          onChange={setTab}
          // 4つ並ぶと「カレンダー」が狭い画面で折り返すので、小さい文字にする。
          dense
        />
      </div>

      <div className="spatial-page-content px-5 lg:px-8">
        {showSkeleton ? (
          <ListSkeleton />
        ) : (
          <div key={tab} className={`planning-workspace planning-workspace--${tab} animate-fade-in motion-reduce:animate-none`}>
        {tab === "today" && (
          <TodayView
            events={events}
            tasks={tasks}
            tripAgenda={tripAgenda}
            onEditEvent={(e) => setEditingEvent(e)}
            onDeleteEvent={handleDeleteEvent}
            onEditTask={handleEditTask}
            onAddSubtask={handleAddSubtask}
            onAddEvent={() => setEditingEvent("new")}
            onAddTask={() => setEditingTask({ mode: "new" })}
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

        {tab === "jobs" && (
          <JobApplicationList
            applications={jobsResult ?? []}
            onEdit={(application) => setEditingJob(application)}
            onDelete={handleDeleteJob}
            onAdd={() => setEditingJob("new")}
          />
        )}
          </div>
        )}
      </div>

      {/* 就活タブにいるときは、選ばせずに応募先の入力へ直行する。「予定・タスク・応募先」の
          3択にすると、予定を足したいだけのときに毎回1つ余分に選ぶことになる。 */}
      <PageFab
        onClick={() => (tab === "jobs" ? setEditingJob("new") : setAddTypeOpen(true))}
        label={tab === "jobs" ? "応募先を追加" : "予定・タスクを追加"}
      >
        <Plus size={24} />
      </PageFab>

      <Sheet open={addTypeOpen} onClose={() => setAddTypeOpen(false)} title="何を追加しますか?">
        {/* 選ぶだけの画面なので、入力欄と同じ面ではなく「押す的」として見せる。 */}
        <div className="choice-grid">
          <button
            type="button"
            onClick={() => {
              setAddTypeOpen(false);
              setEditingEvent("new");
            }}
            className="choice-grid__option"
          >
            <span className="choice-grid__icon">
              <CalendarIcon size={22} />
            </span>
            <strong>予定</strong>
            <small>時間が決まっているもの</small>
          </button>
          <button
            type="button"
            onClick={() => {
              setAddTypeOpen(false);
              setEditingTask({ mode: "new" });
            }}
            className="choice-grid__option"
          >
            <span className="choice-grid__icon">
              <CheckSquare size={22} />
            </span>
            <strong>タスク</strong>
            <small>終わらせたいこと</small>
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
            onSaved={(mode) => {
              setEditingEvent(null);
              // 編集して開いたのに「新しく追加しました」と出たら、更新先を見失っている
              // (EventForm参照)。文言を分けておかないとその食い違いに気付けない。
              showToast(mode === "updated" ? "変更を保存しました" : "新しい予定として追加しました");
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

      <Sheet
        open={editingJob !== null}
        onClose={() => setEditingJob(null)}
        title={editingJob === "new" ? "応募先を追加" : "応募先を編集"}
      >
        {editingJob && (
          <JobApplicationForm
            initial={editingJob === "new" ? undefined : editingJob}
            onSaved={() => {
              setEditingJob(null);
              showToast("保存しました");
            }}
            onCancel={() => setEditingJob(null)}
          />
        )}
      </Sheet>
    </div>
  );
}
