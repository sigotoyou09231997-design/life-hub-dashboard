import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { ensureDefaultSettings } from "./db/schema";
import { startNotificationScheduler, stopNotificationScheduler } from "./lib/notifications";
import { ToastProvider } from "./components/ui/ToastProvider";

import TopPage from "./pages/TopPage";
import SchedulePage from "./pages/SchedulePage";
import TripsPage from "./pages/TripsPage";
import TripDetailPage from "./pages/TripDetailPage";
import RecordsPage from "./pages/RecordsPage";
import SettingsPage from "./pages/SettingsPage";
import ExpensePage from "./pages/records/ExpensePage";
import NotePage from "./pages/records/NotePage";
import DiaryPage from "./pages/records/DiaryPage";
import GoalPage from "./pages/records/GoalPage";
import HabitPage from "./pages/records/HabitPage";
import GmailPage from "./pages/GmailPage";
import GmailCallbackPage from "./pages/GmailCallbackPage";

export default function App() {
  const location = useLocation();
  const isTop = location.pathname === "/";

  useEffect(() => {
    ensureDefaultSettings();
    startNotificationScheduler();
    return () => stopNotificationScheduler();
  }, []);

  return (
    <ToastProvider>
      <div className={`mx-auto min-h-screen bg-white md:shadow-xl ${isTop ? "max-w-3xl" : "max-w-md"}`}>
        <Routes>
          <Route path="/" element={<TopPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/:id" element={<TripDetailPage />} />
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
          <Route path="/gmail" element={<GmailPage />} />
          <Route path="/gmail/callback" element={<GmailCallbackPage />} />
        </Routes>
      </div>
    </ToastProvider>
  );
}
