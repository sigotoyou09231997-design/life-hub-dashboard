import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, ensureDefaultSettings } from "./db/schema";
import { startNotificationScheduler, stopNotificationScheduler } from "./lib/notifications";

import TopPage from "./pages/TopPage";
import SchedulePage from "./pages/SchedulePage";
import TripsPage from "./pages/TripsPage";
import RecordsPage from "./pages/RecordsPage";
import SettingsPage from "./pages/SettingsPage";
import ExpensePage from "./pages/records/ExpensePage";
import NotePage from "./pages/records/NotePage";
import DiaryPage from "./pages/records/DiaryPage";
import GoalPage from "./pages/records/GoalPage";
import HabitPage from "./pages/records/HabitPage";

export default function App() {
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

  return (
    <div className="mx-auto min-h-screen max-w-md bg-white">
      <Routes>
        <Route path="/" element={<TopPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/trips" element={<TripsPage />} />
        {/* 予定・タスクは /schedule に統合済み。旧ブックマーク/リンク対策として残す。 */}
        <Route path="/calendar" element={<Navigate to="/schedule" replace />} />
        <Route path="/records/tasks" element={<Navigate to="/schedule" replace />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/records/expense" element={<ExpensePage />} />
        <Route path="/records/notes" element={<NotePage />} />
        <Route path="/records/diary" element={<DiaryPage />} />
        <Route path="/records/goals" element={<GoalPage />} />
        <Route path="/records/habits" element={<HabitPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </div>
  );
}
