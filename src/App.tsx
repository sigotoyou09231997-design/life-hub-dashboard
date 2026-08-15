import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { db, ensureDefaultSettings } from "./db/schema";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { clearShownPushNotifications } from "./lib/pushNotifications";
import { registerSyncedTable } from "./lib/sync";
import { ToastProvider } from "./components/ui/ToastProvider";
import { UpdateBanner } from "./components/ui/UpdateBanner";
import { AmbientBackground } from "./components/layout/AmbientBackground";
import { AppHeader } from "./components/layout/AppHeader";
import { DesktopSidebar } from "./components/layout/DesktopSidebar";
import { QuickActionBar } from "./components/layout/QuickActionBar";

import AuthGatePage from "./pages/AuthGatePage";
import TopPage from "./pages/TopPage";
import AuthCallbackPage from "./pages/AuthCallbackPage";

const SchedulePage = lazy(() => import("./pages/SchedulePage"));
const TripsPage = lazy(() => import("./pages/TripsPage"));
const TripDetailPage = lazy(() => import("./pages/TripDetailPage"));
const RecordsPage = lazy(() => import("./pages/RecordsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AccountPage = lazy(() => import("./pages/AccountPage"));
const ExpensePage = lazy(() => import("./pages/records/ExpensePage"));
const NotePage = lazy(() => import("./pages/records/NotePage"));
const DiaryPage = lazy(() => import("./pages/records/DiaryPage"));
const GoalPage = lazy(() => import("./pages/records/GoalPage"));
const HabitPage = lazy(() => import("./pages/records/HabitPage"));
const GmailPage = lazy(() => import("./pages/GmailPage"));
const GmailMailPage = lazy(() => import("./pages/GmailMailPage"));
const GmailCallbackPage = lazy(() => import("./pages/GmailCallbackPage"));

function LazyRoute({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-32 items-center justify-center px-5" role="status" aria-live="polite">
          <div className="glass-row rounded-full px-4 py-2 text-xs font-medium text-slate-500/80">
            読み込み中…
          </div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export default function App() {
  const location = useLocation();
  // 一覧(/gmail)だけ、内部スクロールのメールリストを1画面に収める固定高さのflex
  // レイアウト(下記)が必要。/gmail/mail/:id(新規タブで開く単独のメール詳細ページ)は
  // 他の通常ページと同じ、ページ全体が自然にスクロールする挙動にする — 固定高さ+
  // overflow-hiddenのままだと、長い本文/AI返信文が内部スクロール領域に閉じ込められ、
  // スクロールしないと全文が見えなくなってしまうため(2026-08-15 修正)。
  const isGmailListRoute = location.pathname === "/gmail";

  // undefined = still checking, null = confirmed logged out, Session = logged in.
  // Gates the entire app behind account registration/login — nothing (TOP, data,
  // any route) renders without a session. /auth/callback is exempt: it's the
  // landing page for the Google OAuth redirect itself, reached precisely while
  // still logged out, so gating it too would make that login path unreachable.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);
  const isAuthCallbackRoute = location.pathname === "/auth/callback";

  useEffect(() => {
    ensureDefaultSettings();
    // アプリを開いた時点でGmailプッシュ通知はもう本人が確認できる状態なので、端末の通知
    // センターに残っている分(ブロック後に届いた古い通知を含む)をここでまとめて閉じる。
    void clearShownPushNotifications();
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
  }, []);

  if (isSupabaseConfigured && session === undefined && !isAuthCallbackRoute) {
    // 一瞬でも未ログイン画面がちらつくのを避けるための空白 — セッション確認は
    // 通常ミリ秒単位(localStorageから即読める)なので、ローディング表示は最小限でよい。
    return (
      <>
        <AmbientBackground />
        <div className="min-h-screen" />
      </>
    );
  }

  if (isSupabaseConfigured && !session && !isAuthCallbackRoute) {
    return (
      <ToastProvider>
        <AmbientBackground />
        <AuthGatePage />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <AmbientBackground />
      <UpdateBanner />
      <div className="app-viewport">
        <div className={`app-shell glass-shell ${isGmailListRoute ? "app-shell--fixed" : ""}`}>
          <DesktopSidebar />
          <div className="app-workspace">
            <AppHeader />
            <main className={`app-main ${isGmailListRoute ? "app-main--fixed" : ""}`}>
              <div key={location.pathname} className="page-transition">
                <Routes location={location}>
              <Route path="/" element={<TopPage />} />
              <Route path="/schedule" element={<LazyRoute><SchedulePage /></LazyRoute>} />
              <Route path="/trips" element={<LazyRoute><TripsPage /></LazyRoute>} />
              <Route path="/trips/:id" element={<LazyRoute><TripDetailPage /></LazyRoute>} />
              {/* 予定・タスクは /schedule に統合済み。旧ブックマーク/リンク対策として残す。 */}
              <Route path="/calendar" element={<Navigate to="/schedule" replace />} />
              <Route path="/records/tasks" element={<Navigate to="/schedule" replace />} />
              <Route path="/records" element={<LazyRoute><RecordsPage /></LazyRoute>} />
              <Route path="/records/expense" element={<LazyRoute><ExpensePage /></LazyRoute>} />
              <Route path="/records/notes" element={<LazyRoute><NotePage /></LazyRoute>} />
              <Route path="/records/diary" element={<LazyRoute><DiaryPage /></LazyRoute>} />
              <Route path="/records/goals" element={<LazyRoute><GoalPage /></LazyRoute>} />
              <Route path="/records/habits" element={<LazyRoute><HabitPage /></LazyRoute>} />
              <Route path="/settings" element={<LazyRoute><SettingsPage /></LazyRoute>} />
              <Route path="/account" element={<LazyRoute><AccountPage /></LazyRoute>} />
              <Route path="/gmail" element={<LazyRoute><GmailPage /></LazyRoute>} />
              <Route path="/gmail/mail/:emailId" element={<LazyRoute><GmailMailPage /></LazyRoute>} />
              <Route path="/gmail/callback" element={<LazyRoute><GmailCallbackPage /></LazyRoute>} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
                </Routes>
              </div>
            </main>
          </div>
          <QuickActionBar />
        </div>
      </div>
    </ToastProvider>
  );
}
