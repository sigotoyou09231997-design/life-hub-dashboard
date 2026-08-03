import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, ensureDefaultSettings } from "./db/schema";
import { startNotificationScheduler, stopNotificationScheduler } from "./lib/notifications";
import { todayStr } from "./lib/date";
import { BottomTabBar } from "./components/layout/BottomTabBar";
import { AddSheet, type AddType } from "./components/layout/AddSheet";
import { Sheet } from "./components/ui/Sheet";
import { ExpenseForm } from "./components/expense/ExpenseForm";
import { TaskForm } from "./components/tasks/TaskForm";
import { EventForm } from "./components/calendar/EventForm";
import { NoteForm } from "./components/notes/NoteForm";
import { DiaryForm } from "./components/diary/DiaryForm";

import HomePage from "./pages/HomePage";
import CalendarPage from "./pages/CalendarPage";
import RecordsPage from "./pages/RecordsPage";
import SettingsPage from "./pages/SettingsPage";
import ExpensePage from "./pages/records/ExpensePage";
import TaskPage from "./pages/records/TaskPage";
import NotePage from "./pages/records/NotePage";
import DiaryPage from "./pages/records/DiaryPage";
import GoalPage from "./pages/records/GoalPage";
import HabitPage from "./pages/records/HabitPage";

const ADD_TYPE_TITLE: Record<AddType, string> = {
  expense: "支出・収入を追加",
  task: "タスクを追加",
  event: "予定を追加",
  note: "メモを追加",
  diary: "日記を書く",
};

export default function App() {
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addType, setAddType] = useState<AddType | null>(null);

  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);

  useEffect(() => {
    ensureDefaultSettings();
    startNotificationScheduler();
    return () => stopNotificationScheduler();
  }, []);

  useEffect(() => {
    if (settings?.accentColor) {
      document.documentElement.style.setProperty("--color-accent", settings.accentColor);
    }
  }, [settings?.accentColor]);

  function handleSelectAddType(type: AddType) {
    setAddSheetOpen(false);
    setAddType(type);
  }

  function closeQuickAdd() {
    setAddType(null);
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-white">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/records/expense" element={<ExpensePage />} />
        <Route path="/records/tasks" element={<TaskPage />} />
        <Route path="/records/notes" element={<NotePage />} />
        <Route path="/records/diary" element={<DiaryPage />} />
        <Route path="/records/goals" element={<GoalPage />} />
        <Route path="/records/habits" element={<HabitPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>

      <BottomTabBar onAddClick={() => setAddSheetOpen(true)} />
      <AddSheet open={addSheetOpen} onClose={() => setAddSheetOpen(false)} onSelect={handleSelectAddType} />

      <Sheet open={addType !== null} onClose={closeQuickAdd} title={addType ? ADD_TYPE_TITLE[addType] : ""}>
        {addType === "expense" && <ExpenseForm onSaved={closeQuickAdd} onCancel={closeQuickAdd} />}
        {addType === "task" && <TaskForm onSaved={closeQuickAdd} onCancel={closeQuickAdd} />}
        {addType === "event" && (
          <EventForm defaultDate={todayStr()} onSaved={closeQuickAdd} onCancel={closeQuickAdd} />
        )}
        {addType === "note" && <NoteForm onSaved={closeQuickAdd} onCancel={closeQuickAdd} />}
        {addType === "diary" && <DiaryForm onSaved={closeQuickAdd} onCancel={closeQuickAdd} />}
      </Sheet>
    </div>
  );
}
