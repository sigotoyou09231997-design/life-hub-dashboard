import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bell, Home, Search, Settings as SettingsIcon } from "lucide-react";
import type { Session } from "@supabase/auth-js";
import { auth, isSupabaseConfigured } from "../../lib/supabase";
import { avatarColor, avatarInitial, parseSender } from "../../lib/gmail";
import { formatGmailTimestamp } from "../../lib/date";
import { useNotificationSignals } from "../../lib/notificationSignals";
import { useUsageAlerts } from "../../hooks/useFeatureUsage";
import { Sheet } from "../ui/Sheet";
import { EmptyState } from "../ui/EmptyState";
import { AccountSwitcher } from "./AccountSwitcher";
import { GlobalSearch } from "./GlobalSearch";

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
  const signals = useNotificationSignals();
  // 使われなくなった機能のお知らせ。数え方が他の通知と違う(1日1回・Supabaseで数える)ので、
  // useNotificationSignals には混ぜずに別に持つ。
  const usage = useUsageAlerts();
  const notificationCount = signals.total + usage.alerts.length;

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
          <Link
            to="/"
            aria-label="ホーム"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <Home size={19} />
          </Link>
        </div>

        <div className="app-header__title">
          <span className="app-header__mobile-brand">LIFE HUB</span>

        </div>

        <div className="app-header__actions">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="まとめて検索"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      <Sheet open={notifOpen} onClose={() => setNotifOpen(false)} title="通知">
        {notificationCount === 0 ? (
          <EmptyState icon={Bell} title="新しい通知はありません" />
        ) : (
          <div className="space-y-5">
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
