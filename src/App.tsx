import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, ensureDefaultSettings } from "./db/schema";
import { startNotificationScheduler, stopNotificationScheduler } from "./lib/notifications";
import { registerSyncedTable } from "./lib/sync";
import { resolveAccentPreset } from "./lib/accentColors";
import { ToastProvider } from "./components/ui/ToastProvider";
import { UpdateBanner } from "./components/ui/UpdateBanner";
import { AppHeader } from "./components/layout/AppHeader";
import { QuickActionBar } from "./components/layout/QuickActionBar";

import TopPage from "./pages/TopPage";
import SchedulePage from "./pages/SchedulePage";
import TripsPage from "./pages/TripsPage";
import TripDetailPage from "./pages/TripDetailPage";
import RecordsPage from "./pages/RecordsPage";
import SettingsPage from "./pages/SettingsPage";
import AccountPage from "./pages/AccountPage";
import ExpensePage from "./pages/records/ExpensePage";
import NotePage from "./pages/records/NotePage";
import DiaryPage from "./pages/records/DiaryPage";
import GoalPage from "./pages/records/GoalPage";
import HabitPage from "./pages/records/HabitPage";
import GmailPage from "./pages/GmailPage";
import GmailMailPage from "./pages/GmailMailPage";
import GmailCallbackPage from "./pages/GmailCallbackPage";
import AuthCallbackPage from "./pages/AuthCallbackPage";

/** The outer glass shell is capped at 1180px on every route so the frame
 * itself stays consistent, but forcing every page's own CONTENT to that same
 * 1180px reads as too much empty margin on narrower, simpler screens. This
 * only takes effect at lg+ (1024px) — below that the shell itself is still
 * narrow (max-w-3xl/max-w-md), so no extra cap is needed. TOP is deliberately
 * excluded (empty string): its dashboard grid is meant to use the full shell
 * width. */
function innerContentWidthClass(pathname: string): string {
  if (pathname === "/") return "";
  if (pathname.startsWith("/gmail")) return "lg:max-w-[1100px] lg:mx-auto";
  if (pathname === "/records/expense" || pathname === "/records/notes" || pathname === "/schedule" || pathname.startsWith("/trips/")) {
    return "lg:max-w-[960px] lg:mx-auto";
  }
  // Settings/Account/trip-list/legacy record pages/forms-only screens: narrow and centered.
  return "lg:max-w-[820px] lg:mx-auto";
}

export default function App() {
  const location = useLocation();
  const isTop = location.pathname === "/";
  // Gmailの3ペインだけ、固定高さのflexレイアウト(下記)が必要なため引き続き判定。
  const isGmailRoute = location.pathname.startsWith("/gmail");
  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);

  useEffect(() => {
    ensureDefaultSettings();
    startNotificationScheduler();
    // PC/スマホ同期対象。Supabaseにログインしていない間は何もしない安全なno-op —
    // ログインした瞬間に自動で同期を開始する(src/lib/sync.tsのensureAuthListener参照)。
    // 対象外: settings(端末ごとに別IDで作られるsingletonのため)、
    // diaryEntries(photosがBlobでJSON化できないため)、
    // gmailAccounts/syncedEmails/draftReplies(トークン・メール本文を含むためローカル限定)。
    registerSyncedTable(db.transactions, "transactions");
    registerSyncedTable(db.fixedCosts, "fixed_costs");
    registerSyncedTable(db.calendarEvents, "calendar_events");
    registerSyncedTable(db.tasks, "tasks");
    registerSyncedTable(db.notes, "notes");
    registerSyncedTable(db.goals, "goals");
    registerSyncedTable(db.habits, "habits");
    registerSyncedTable(db.habitLogs, "habit_logs");
    registerSyncedTable(db.salaries, "salaries");
    registerSyncedTable(db.trips, "trips");
    registerSyncedTable(db.tripSchedule, "trip_schedule");
    registerSyncedTable(db.tripExpenses, "trip_expenses");
    registerSyncedTable(db.tripPackingItems, "trip_packing_items");
    registerSyncedTable(db.paypayTransactions, "paypay_transactions");
    return () => stopNotificationScheduler();
  }, []);

  // Applies the user's chosen accent (Settings → 外観) to the whole app; per-area
  // pages (money/schedule/notes/trips) still override it locally via AREA_ACCENT_STYLE.
  useEffect(() => {
    const preset = resolveAccentPreset(settings?.accentColor);
    document.documentElement.style.setProperty("--color-accent", preset.value);
    document.documentElement.style.setProperty("--color-accent-light", preset.light);
  }, [settings?.accentColor]);

  return (
    <ToastProvider>
      <UpdateBanner />
      {/* The page background must stay visible as a margin around the shell
          at every width, not just md+ — a small ~8px gap on mobile, a
          generous one on desktop. min-h uses a calc matching the vertical
          margin so the shell doesn't add extra scrollable height beyond the
          viewport. At lg+ (1024px) the shell stops being a narrow
          mobile-width column stuck at the left and becomes a centered,
          genuinely wide desktop panel (width 100%-4rem capped at 1180px) —
          this is what lets TOP's own lg:grid-cols-2 today-card actually get
          the room it needs. */}
      {/* flow-root here exists purely to stop the shell's own my-2/lg:my-6
          margin from collapsing through into #root — with the Gmail route's
          fixed-height shell below, that collapse otherwise adds a phantom
          ~24px of scrollable space past the shell's real bottom edge (nothing
          renders there, but the page technically becomes scrollable). Unlike
          overflow-hidden, flow-root blocks the collapse without clipping the
          shell's own box-shadow, so this is a pure no-op everywhere else. */}
      <div className="flow-root">
        <div
          className={`relative mx-2 my-2 min-h-[calc(100vh-1rem)] glass-shell rounded-2xl md:mx-8 md:my-6 md:min-h-[calc(100vh-3rem)] md:rounded-3xl md:shadow-xl lg:mx-auto lg:my-6 lg:w-[calc(100%-4rem)] lg:max-w-[1180px] ${
            isGmailRoute ? "lg:flex lg:h-[calc(100dvh-3rem)] lg:flex-col lg:overflow-hidden" : "lg:min-h-[calc(100vh-3rem)]"
          } ${isTop ? "max-w-3xl" : "max-w-md"}`}
        >
          <AppHeader />
          <div
            className={`pb-28 ${innerContentWidthClass(location.pathname)} ${
              isGmailRoute ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden" : ""
            }`}
          >
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
              <Route path="/account" element={<AccountPage />} />
              <Route path="/gmail" element={<GmailPage />} />
              <Route path="/gmail/mail/:emailId" element={<GmailMailPage />} />
              <Route path="/gmail/callback" element={<GmailCallbackPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
            </Routes>
          </div>
          <QuickActionBar />
        </div>
      </div>
    </ToastProvider>
  );
}
