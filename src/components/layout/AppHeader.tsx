import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Home, Settings as SettingsIcon } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import { avatarColor, avatarInitial, parseSender } from "../../lib/gmail";
import { formatGmailTimestamp } from "../../lib/date";
import { useNotificationSignals } from "../../lib/notificationSignals";
import { Sheet } from "../ui/Sheet";
import { EmptyState } from "../ui/EmptyState";

/** Persistent, app-wide header (avatar / "LIFE HUB" / bell / settings) — shown
 * above every page's own PageHeader (back arrow + title), which keeps its
 * per-page navigation. Deliberately never shows name/email/sync state here;
 * that lives on the Account screen behind the avatar. */
export function AppHeader() {
  const [session, setSession] = useState<Session | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const signals = useNotificationSignals();

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  const avatarUrl = session?.user.user_metadata?.avatar_url as string | undefined;
  const displayName =
    (session?.user.user_metadata?.full_name as string | undefined) ?? session?.user.email ?? "アカウント";

  return (
    <>
      {/* 1fr/auto/1fr keeps "LIFE HUB" visually centered even though the left
          (1 avatar icon) and right (2 icons) groups aren't the same width.
          Sticky + its own glass-card layer so scrolled content never shows
          through or collides with it. */}
      {/* Matches the shell's own corner radius (rounded-2xl / md:rounded-3xl)
          so the header's top edge aligns with it exactly — the shell has no
          overflow:hidden (that would risk clipping every page's fixed-position
          Sheet), so this alignment is what keeps square corners from poking
          out past the shell's rounded top instead of relying on clipping. */}
      <header className="glass-header sticky top-0 z-40 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-t-2xl px-5 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] md:rounded-t-3xl">
        <div className="flex items-center justify-start gap-1">
          <Link
            to="/account"
            aria-label="アカウント"
            className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(displayName)}`}
              >
                {avatarInitial(displayName)}
              </div>
            )}
          </Link>
          {/* どのページからでもTOPへ1タップで戻れるように — Gmailのメール詳細のような
              単独ページ(新規タブで開き、「戻る」がタブを閉じるだけ)からも同様に使える。 */}
          <Link
            to="/"
            aria-label="ホーム"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <Home size={19} />
          </Link>
        </div>

        <span className="truncate text-base font-bold tracking-tight text-navy">LIFE HUB</span>

        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setNotifOpen(true)}
            aria-label="通知"
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <Bell size={19} />
            {signals.total > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
            )}
          </button>
          <Link
            to="/settings"
            aria-label="設定"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <SettingsIcon size={19} />
          </Link>
        </div>
      </header>

      <Sheet open={notifOpen} onClose={() => setNotifOpen(false)} title="通知">
        {signals.total === 0 ? (
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
                      <a
                        key={email.id}
                        href={`/gmail/mail/${email.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
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
                      </a>
                    );
                  })}
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
          </div>
        )}
      </Sheet>
    </>
  );
}
