import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bell, Home, Plus, Search, Settings as SettingsIcon } from "lucide-react";
import type { Session } from "@supabase/auth-js";
import { auth, isSupabaseConfigured } from "../../lib/supabase";
import { avatarColor, avatarInitial, parseSender } from "../../lib/gmail";
import { formatGmailTimestamp } from "../../lib/date";
import { useNotificationSignals } from "../../lib/notificationSignals";
import { useUsageAlerts } from "../../hooks/useFeatureUsage";
import { useSyncProblems } from "../../lib/syncProblems";
import { paletteShortcutLabel } from "../../lib/commandPalette";
import { Sheet } from "../ui/Sheet";
import { EmptyState } from "../ui/EmptyState";
import { AccountSwitcher } from "./AccountSwitcher";
import { GlobalSearch, usePaletteShortcut } from "./GlobalSearch";
import { openAddChooser } from "./AddChooser";
import { usePageAddAction } from "../../lib/pageAddAction";

/** Persistent, app-wide header (avatar / "LIFE HUB" / bell / settings) — shown
 * above every page's own PageHeader (back arrow + title), which keeps its
 * per-page navigation. Deliberately never shows name/email/sync state here;
 * that lives on the Account screen behind the avatar. */
export function AppHeader() {
  const { pathname } = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const pageAdd = usePageAddAction();
  const signals = useNotificationSignals();
  // 使われなくなった機能のお知らせ。数え方が他の通知と違う(1日1回・Supabaseで数える)ので、
  // useNotificationSignals には混ぜずに別に持つ。
  const usage = useUsageAlerts();
  // サーバーに弾かれて送れずにいる変更。失敗が console にしか出ず、スマホで3週間以上
  // 気づけなかったので(2026-09-21)、ここに出す。
  const syncProblems = useSyncProblems();
  const notificationCount = signals.total + usage.alerts.length + syncProblems.length;

  // ⌘K / Ctrl+K でどこからでも、まとめて検索を開く(GlobalSearch.tsx の usePaletteShortcut)。
  // 閉じる関数を作り直さないのは、Sheet が onClose の変化でフォーカスを動かし直すため。
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  usePaletteShortcut(searchOpen, setSearchOpen);
  const shortcutLabel = useMemo(() => paletteShortcutLabel(), []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  const avatarUrl = session?.user.user_metadata?.avatar_url as string | undefined;
  const displayName =
    (session?.user.user_metadata?.full_name as string | undefined) ?? session?.user.email ?? "アカウント";

  const avatar = avatarUrl ? (
    <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
  ) : (
    <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(displayName)}`}>
      {avatarInitial(displayName)}
    </div>
  );

  return (
    <>
      <header className={`glass-header app-header ${pathname === "/" ? "app-header--home" : ""}`}>
        <div className="app-header__mobile-left">
          {/* アイコンはアカウント画面へのリンクではなく、切り替えの入口。
              アカウント画面へはそのシートの中から入る(AccountSwitcher)。 */}
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            aria-label="アカウント"
            className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {avatar}
          </button>
          {/* ホームを開いている時は、この家の印を光らせる。下のナビにホームを入れていない人は、
              前は「すべて」が光っていて、いちばん見る画面なのに「その他」の中にいるように見えた
              (UI/UX 調査メモ 第2弾 S-2)。 */}
          <Link
            to="/"
            aria-label="ホーム"
            aria-current={pathname === "/" ? "page" : undefined}
            className={`app-header__home flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${pathname === "/" ? "is-active" : ""}`}
          >
            <Home size={19} />
          </Link>
        </div>

        <div className="app-header__title">
          <span className="app-header__mobile-brand">LIFE HUB</span>

        </div>

        {/* PC(lg以上)だけの検索欄。入力欄の見た目をしたボタンで、押すと下の虫めがねと同じ
            「まとめて検索」のシートを開く(打つのはシートの中)。スマホでは出さず、虫めがねのまま。
            この並び(.app-header__desk-tools)には、あとで「＋追加」のボタンも横に足す予定 —
            足す時はこの div の中、検索欄の後ろに置けばよい(並べ方は theme-teal.css の 6b)。 */}
        <div className="app-header__desk-tools">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-keyshortcuts="Meta+K Control+K"
            className="app-header__search-field"
          >
            <Search size={16} aria-hidden="true" />
            <span className="app-header__search-field-label">検索・操作</span>
            <kbd className="app-header__search-field-key">{shortcutLabel}</kbd>
          </button>
          {/* PCの「＋追加」(UI/UX 調査メモ C-5・A-3)。右下の「＋」はPCでは画面の端で遠く、
              ホームには追加の入口が無かった。押すと「何を追加しますか?」(支出・予定・タスク・メモ)。 */}
          {/* 画面に「＋」があればその働き(旅行を追加・新規メール…)、無ければ選ぶシート。
              PC では右下の「＋」を出さないので、ここが唯一の入口(UI/UX 調査メモ 第2弾 P-2)。 */}
          <button type="button" onClick={pageAdd ? pageAdd.run : openAddChooser} className="app-header__add">
            <Plus size={16} aria-hidden="true" />
            {pageAdd && pageAdd.label !== "追加する" ? pageAdd.label : "追加"}
          </button>
        </div>

        <div className="app-header__actions">
          {/* PCでは左の検索欄があるので、虫めがねはスマホだけ(lg:hidden)。 */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="まとめて検索"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 lg:hidden"
          >
            <Search size={19} />
          </button>
          <button
            type="button"
            onClick={() => setNotifOpen(true)}
            aria-label="通知"
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <Bell size={19} />
            {notificationCount > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
            )}
          </button>
          <Link
            to="/settings"
            aria-label="設定"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 lg:hidden"
          >
            <SettingsIcon size={19} />
          </Link>
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            aria-label="アカウント"
            className="hidden shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 lg:block"
          >
            {avatar}
          </button>
        </div>
      </header>

      <AccountSwitcher open={accountOpen} onClose={() => setAccountOpen(false)} activeUserId={session?.user.id} />

      <GlobalSearch open={searchOpen} onClose={closeSearch} />

      <Sheet open={notifOpen} onClose={() => setNotifOpen(false)} title="通知">
        {notificationCount === 0 ? (
          <EmptyState icon={Bell} title="新しい通知はありません" />
        ) : (
          <div className="space-y-5">
            {syncProblems.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium text-danger">PCとスマホで同期できていない変更</p>
                <div className="space-y-2">
                  {syncProblems.map((problem) => (
                    <Link
                      key={problem.table}
                      to="/account"
                      onClick={() => setNotifOpen(false)}
                      className="glass-row block rounded-xl p-3 text-left transition-colors active:bg-white/70"
                    >
                      <p className="text-sm font-medium text-slate-900">
                        {problem.label}の変更 {problem.count}件
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">{problem.message}</p>
                      <p className="mt-0.5 break-all text-[11px] text-slate-400">{problem.detail}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {signals.gmailUnprocessed.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium text-slate-600">Gmail未処理</p>
                <div className="space-y-2">
                  {signals.gmailUnprocessed.map((email) => {
                    const sender = parseSender(email.from);
                    return (
                      <Link
                        key={email.id}
                        to={`/gmail/mail/${email.id}`}
                        onClick={() => setNotifOpen(false)}
                        className="glass-row flex items-start gap-3 rounded-xl p-3 text-left transition-colors active:bg-white/70"
                      >
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColor(sender.email)}`}
                        >
                          {avatarInitial(sender.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">{sender.name}</p>
                          <p className="truncate text-xs text-slate-500">{email.subject}</p>
                        </div>
                        <span className="shrink-0 text-xs text-slate-400">{formatGmailTimestamp(email.receivedAt)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {signals.budgetForecasts.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium text-warning">このままだと予算を超えそう</p>
                <div className="space-y-2">
                  {signals.budgetForecasts.map((forecast) => (
                    <Link
                      key={forecast.category}
                      to="/records/expense"
                      onClick={() => setNotifOpen(false)}
                      className="glass-row block rounded-xl p-3 text-left transition-colors active:bg-white/70"
                    >
                      <p className="text-sm font-medium text-slate-900">{forecast.category}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        今のペースだと ¥{forecast.projected.toLocaleString()}(上限 ¥
                        {forecast.budget.toLocaleString()})
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {signals.overdueTasks.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium text-danger">期限切れのタスク</p>
                <div className="space-y-2">
                  {signals.overdueTasks.map((task) => (
                    <Link
                      key={task.id}
                      to="/schedule?view=list"
                      onClick={() => setNotifOpen(false)}
                      className="glass-row block rounded-xl p-3 text-left text-sm font-medium text-slate-900 transition-colors active:bg-white/70"
                    >
                      {task.title}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {usage.alerts.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-600">最近使われていない機能</p>
                  <button
                    type="button"
                    onClick={usage.dismiss}
                    className="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-slate-500 transition-colors active:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    今月は表示しない
                  </button>
                </div>
                <div className="space-y-2">
                  {usage.alerts.map((alert) => (
                    <Link
                      key={alert.usage.feature.id}
                      to="/review"
                      onClick={() => setNotifOpen(false)}
                      className="glass-row block rounded-xl p-3 text-left transition-colors active:bg-white/70"
                    >
                      <p className="text-sm font-medium text-slate-900">{alert.message}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{alert.detail}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
