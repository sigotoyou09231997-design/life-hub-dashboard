import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import type { Session } from "@supabase/auth-js";
import { ensureDefaultSettings } from "./db/schema";
import { auth, isSupabaseConfigured } from "./lib/supabase";
import { clearShownPushNotifications } from "./lib/pushNotifications";
import { startSync, stopSync } from "./lib/syncRuntime";
import { ToastProvider } from "./components/ui/ToastProvider";
import { UpdateBanner } from "./components/ui/UpdateBanner";
import { AmbientBackground } from "./components/layout/AmbientBackground";
import { AppHeader } from "./components/layout/AppHeader";
import { DesktopSidebar } from "./components/layout/DesktopSidebar";
import { QuickActionBar } from "./components/layout/QuickActionBar";
import { usePageMotion } from "./hooks/usePageMotion";

import AuthGatePage from "./pages/AuthGatePage";
import TopPage from "./pages/TopPage";
import AuthCallbackPage from "./pages/AuthCallbackPage";

const SchedulePage = lazy(() => import("./pages/SchedulePage"));
const TripsPage = lazy(() => import("./pages/TripsPage"));
const TripDetailPage = lazy(() => import("./pages/TripDetailPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AccountPage = lazy(() => import("./pages/AccountPage"));
const ExpensePage = lazy(() => import("./pages/records/ExpensePage"));
const NotePage = lazy(() => import("./pages/records/NotePage"));
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
  // HOME以外の全ページに、HOMEと同じ出現アニメーションとスクロール連動を与える。
  const pageMotionRef = usePageMotion<HTMLDivElement>(location.pathname);
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
  const [syncReady, setSyncReady] = useState(false);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    let transition = 0;
    const applySession = async (next: Session | null) => {
      const currentTransition = ++transition;
      if (!active) return;
      setSession(next);
      if (!next) {
        stopSync();
        setSyncReady(true);
        return;
      }
      setSyncReady(false);
      try {
        await startSync(next.user.id, next.access_token);
      } catch (error) {
        console.error("[sync] failed to initialize:", error);
      }
      if (active && transition === currentTransition) setSyncReady(true);
    };
    auth.getSession().then(({ data }) => void applySession(data.session));
    const { data: listener } = auth.onAuthStateChange((_event, next) => void applySession(next));
    return () => {
      active = false;
      stopSync();
      listener.subscription.unsubscribe();
    };
  }, []);
  const isAuthCallbackRoute = location.pathname === "/auth/callback";

  useEffect(() => {
    ensureDefaultSettings();
    // アプリを開いた時点でGmailプッシュ通知はもう本人が確認できる状態なので、端末の通知
    // センターに残っている分(ブロック後に届いた古い通知を含む)をここでまとめて閉じる。
    void clearShownPushNotifications();
  }, []);

  // ページ切り替え時の「読み込み中…」表示を体感上ほぼ無くすため、ログイン後の暇な
  // タイミング(requestIdleCallback)で全lazyページのJSチャンクを先読みしておく。
  // 初回起動直後の重要な描画とは competing しないよう、あえて即時ではなくidle時に行う。
  useEffect(() => {
    if (isSupabaseConfigured && !(session && syncReady)) return;
    const prefetch = () => {
      void import("./pages/SchedulePage");
      void import("./pages/TripsPage");
      void import("./pages/TripDetailPage");
      void import("./pages/SettingsPage");
      void import("./pages/AccountPage");
      void import("./pages/records/ExpensePage");
      void import("./pages/records/NotePage");
      void import("./pages/GmailPage");
      void import("./pages/GmailMailPage");
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(prefetch);
    } else {
      window.setTimeout(prefetch, 1000);
    }
  }, [isSupabaseConfigured, session, syncReady]);

  if (isSupabaseConfigured && (session === undefined || (session && !syncReady)) && !isAuthCallbackRoute) {
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
              <div key={location.pathname} ref={pageMotionRef} className="page-transition">
                <Routes location={location}>
              <Route path="/" element={<TopPage />} />
              <Route path="/schedule" element={<LazyRoute><SchedulePage /></LazyRoute>} />
              <Route path="/trips" element={<LazyRoute><TripsPage /></LazyRoute>} />
              <Route path="/trips/:id" element={<LazyRoute><TripDetailPage /></LazyRoute>} />
              {/* 予定・タスクは /schedule に統合済み。旧ブックマーク/リンク対策として残す。 */}
              <Route path="/calendar" element={<Navigate to="/schedule" replace />} />
              <Route path="/records/tasks" element={<Navigate to="/schedule" replace />} />
              <Route path="/records/expense" element={<LazyRoute><ExpensePage /></LazyRoute>} />
              <Route path="/records/notes" element={<LazyRoute><NotePage /></LazyRoute>} />
              {/* 日記・目標・習慣は廃止。旧ブックマーク/リンク対策として残す。 */}
              <Route path="/records" element={<Navigate to="/" replace />} />
              <Route path="/records/diary" element={<Navigate to="/" replace />} />
              <Route path="/records/goals" element={<Navigate to="/" replace />} />
              <Route path="/records/habits" element={<Navigate to="/" replace />} />
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
