import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { db, ensureDefaultSettings } from "./db/schema";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { clearShownPushNotifications } from "./lib/pushNotifications";
import { registerSyncedTable } from "./lib/sync";
import { ToastProvider } from "./components/ui/ToastProvider";
import { UpdateBanner } from "./components/ui/UpdateBanner";
import { AppHeader } from "./components/layout/AppHeader";
import { QuickActionBar } from "./components/layout/QuickActionBar";

import AuthGatePage from "./pages/AuthGatePage";
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
    return <div className="min-h-screen" />;
  }

  if (isSupabaseConfigured && !session && !isAuthCallbackRoute) {
    return (
      <ToastProvider>
        <AuthGatePage />
      </ToastProvider>
    );
  }

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
            isGmailListRoute ? "lg:flex lg:h-[calc(100dvh-3rem)] lg:flex-col lg:overflow-hidden" : "lg:min-h-[calc(100vh-3rem)]"
          } ${isTop ? "max-w-3xl" : "max-w-md"}`}
        >
          <AppHeader />
          <div
            className={`pb-28 ${innerContentWidthClass(location.pathname)} ${
              isGmailListRoute ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden" : ""
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
