import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import type { Session } from "@supabase/auth-js";
import { ensureDefaultSettings } from "./db/schema";
import { auth, isSupabaseConfigured } from "./lib/supabase";
import { clearShownPushNotifications } from "./lib/pushNotifications";
import { flushDueSnoozedNotifications } from "./lib/snoozedNotifications";
import { startSync, stopSync } from "./lib/syncRuntime";
import { ensureDataOwner } from "./lib/dataOwner";
import { IS_ADDING_ACCOUNT } from "./lib/accounts";
import { refreshViewportGap } from "./lib/viewport";
import { finishAddAccount, rememberSignedInAccount } from "./lib/accountSwitch";
import { ToastProvider } from "./components/ui/ToastProvider";
import { ConfirmProvider } from "./components/ui/ConfirmProvider";
import { UpdateBanner } from "./components/ui/UpdateBanner";
import { AmbientBackground } from "./components/layout/AmbientBackground";
import { AppHeader } from "./components/layout/AppHeader";
import { DesktopSidebar } from "./components/layout/DesktopSidebar";
import { QuickActionBar } from "./components/layout/QuickActionBar";
import { usePageMotion } from "./hooks/usePageMotion";
import { usePlaceReminderWatch } from "./hooks/usePlaceReminderWatch";

import AuthGatePage from "./pages/AuthGatePage";
import TopPage from "./pages/TopPage";
import AuthCallbackPage from "./pages/AuthCallbackPage";

const SchedulePage = lazy(() => import("./pages/SchedulePage"));
const TripsPage = lazy(() => import("./pages/TripsPage"));
const TripDetailPage = lazy(() => import("./pages/TripDetailPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AccountPage = lazy(() => import("./pages/AccountPage"));
const ChangelogPage = lazy(() => import("./pages/ChangelogPage"));
const ReviewPage = lazy(() => import("./pages/ReviewPage"));
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

/** 画面のどこからでも使う土台(トースト・確認ダイアログ)をまとめる。 */
function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}

export default function App() {
  const location = useLocation();
  // HOME以外の全ページに、HOMEと同じ出現アニメーションとスクロール連動を与える。
  const pageMotionRef = usePageMotion<HTMLDivElement>(location.pathname);
  // 場所リマインドの見張り。下の早期returnより前に置く(フックの数を変えないため)。
  // リマインドが1件も無いうちは位置情報に触らないので、使っていない人には何も起きない。
  usePlaceReminderWatch();
  // 画面を切り替えたら、画面下に貼りつくもの(追従ナビ・追加ボタン)の位置を測り直す。
  // iOSは、キーボードが出ている入力欄が画面ごと消えると focusout を出さないことが
  // あり、そのままだと短いままの画面の高さが残って、ナビとボタンが画面の途中に
  // 貼りついたままになる(src/lib/viewport.ts の refreshViewportGap 参照)。
  useEffect(() => {
    refreshViewportGap();
  }, [location.pathname]);
  // 一覧(/gmail)だけ、内部スクロールのメールリストを1画面に収める固定高さのflex
  // レイアウト(下記)が必要。/gmail/mail/:id(一覧から同じタブで開くメール1通の画面)は
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
      // 「アカウントを追加」の最中のログインは、いま開いているアカウントとは別物。
      // 画面に反映する前に打ち切って、追加したアカウントの側でページごと開き直す —
      // ここでsetSessionしてしまうと、読み込み直しが始まるまでの一瞬だけ「新しい
      // アカウントでログイン中なのに、中身は元のアカウントの端末内データ」になる。
      if (next && IS_ADDING_ACCOUNT) {
        finishAddAccount(next);
        return;
      }
      setSession(next);
      if (!next) {
        stopSync();
        setSyncReady(true);
        return;
      }
      // この端末に登録済みのアカウント一覧に記録する(ヘッダーの切り替えがここを読む)。
      rememberSignedInAccount(next);
      setSyncReady(false);
      // 同期を始める前に、この端末のローカルデータが本当にこのユーザーのものか確かめる。
      // 別アカウントでログインし直した場合は空にしてから同期する(src/lib/dataOwner.ts)。
      // ここで失敗しても同期の開始は止めない — 持ち主の確認ができないことより、
      // 同期そのものが黙って動かなくなる方が実害が大きい。
      try {
        if (await ensureDataOwner(next.user.id)) await ensureDefaultSettings();
      } catch (error) {
        console.error("[dataOwner] failed to verify local data owner:", error);
      }
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
    // そのあとで「あとで」(スヌーズ)の出し直しを見る — 順番が逆だと、出したそばから
    // ここで閉じてしまう。Service Workerが止められて待てなかったぶんの受け皿
    // (src/lib/snoozedNotifications.ts)。
    void (async () => {
      await clearShownPushNotifications();
      await flushDueSnoozedNotifications();
    })();
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
      void import("./pages/ReviewPage");
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
    // アカウント追加の最中は、同じログイン画面を「追加」用に出す — 追加用の一時領域を
    // 見ているのでセッションが無く、ここに落ちてくる(src/lib/accountSwitch.ts)。
    return (
      <ToastProvider>
        <AmbientBackground />
        <AuthGatePage addingAccount={IS_ADDING_ACCOUNT} />
      </ToastProvider>
    );
  }

  return (
    <AppProviders>
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
              <Route path="/review" element={<LazyRoute><ReviewPage /></LazyRoute>} />
              <Route path="/records/expense" element={<LazyRoute><ExpensePage /></LazyRoute>} />
              <Route path="/records/notes" element={<LazyRoute><NotePage /></LazyRoute>} />
              {/* 目標・習慣は廃止。日記は旅行詳細のタブに入れたので単独の画面は無い。
                  旧ブックマーク/リンク対策として、いずれもホームへ返す。 */}
              <Route path="/records" element={<Navigate to="/" replace />} />
              <Route path="/records/diary" element={<Navigate to="/" replace />} />
              <Route path="/records/goals" element={<Navigate to="/" replace />} />
              <Route path="/records/habits" element={<Navigate to="/" replace />} />
              <Route path="/settings" element={<LazyRoute><SettingsPage /></LazyRoute>} />
              <Route path="/account" element={<LazyRoute><AccountPage /></LazyRoute>} />
              <Route path="/changelog" element={<LazyRoute><ChangelogPage /></LazyRoute>} />
              <Route path="/gmail" element={<LazyRoute><GmailPage /></LazyRoute>} />
              <Route path="/gmail/mail/:emailId" element={<LazyRoute><GmailMailPage /></LazyRoute>} />
              <Route path="/gmail/callback" element={<LazyRoute><GmailCallbackPage /></LazyRoute>} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              {/* 知らないURLはヘッダーとサイドバーだけの真っ白な画面になっていた
                  (どのRouteにも当たらないと中身が何も描かれない)。ホームに戻す。 */}
              <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </main>
            {/* 右下の丸ボタン(PageFab)の置き場。ページの中(.page-transition)に置くと、
                切り替えのアニメーションが position:fixed の基準になってボタンが動いて
                見えるので、その外側に出す(src/components/ui/PageFab.tsx)。 */}
            <div id="page-fab-root" />
          </div>
          <QuickActionBar />
        </div>
      </div>
    </AppProviders>
  );
}
