import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { Session } from "@supabase/supabase-js";
import { RefreshCw, ChevronRight } from "lucide-react";
import { db } from "../db/schema";
import { isSupabaseConfigured, supabase, getRedirectUri } from "../lib/supabase";
import { syncNow } from "../lib/sync";
import { getDeviceId } from "../lib/deviceId";
import { avatarColor, avatarInitial } from "../lib/gmail";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/ToastProvider";

/** Identity + app-login screen, reached from the header's avatar. Deliberately
 * narrow in scope: profile photo/name/email, app login state, login/logout,
 * and a link into Settings — Gmail account add/remove and its own connection
 * management stay in Settings so there's exactly one place that owns each. */
export default function AccountPage() {
  const showToast = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [syncing, setSyncing] = useState(false);
  const gmailAccounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleGoogleLogin() {
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: getRedirectUri() } });
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    showToast("ログアウトしました");
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const summary = await syncNow();
      // TODO: temporary diagnostic alert, switch back to a plain toast once sync is confirmed working everywhere.
      alert(`この端末のID: ${getDeviceId()}\n${summary}`);
    } catch (err) {
      alert(`同期に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  }

  const avatarUrl = session?.user.user_metadata?.avatar_url as string | undefined;
  const displayName =
    (session?.user.user_metadata?.full_name as string | undefined) ?? session?.user.email ?? "";

  return (
    <div className="pb-10">
      <PageHeader title="アカウント" backTo="/" />

      <div className="space-y-4 px-5">
        {!isSupabaseConfigured ? (
          <Card>
            <p className="text-sm text-slate-500">アカウント機能は現在この環境では利用できません。</p>
          </Card>
        ) : session ? (
          <>
            <Card className="flex items-center gap-4">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
              ) : (
                <div
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white ${avatarColor(displayName)}`}
                >
                  {avatarInitial(displayName)}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{displayName}</p>
                <p className="truncate text-sm text-slate-500">{session.user.email}</p>
                <p className="mt-1 text-xs text-success">この端末でログイン中</p>
              </div>
            </Card>

            <Card>
              <p className="mb-1 text-sm font-medium text-slate-600">同期</p>
              <p className="mb-3 text-xs text-slate-400">
                ログインした端末同士で、お金管理・予定・タスクなどのデータがリアルタイムに同期されます。
              </p>
              <Button variant="secondary" className="w-full" onClick={handleSync} disabled={syncing}>
                <RefreshCw size={16} className={syncing ? "animate-spin motion-reduce:animate-none" : ""} />
                {syncing ? "同期中..." : "今すぐ同期"}
              </Button>
            </Card>

            {gmailAccounts && gmailAccounts.length > 0 && (
              <Card>
                <p className="mb-1 text-sm font-medium text-slate-600">Gmail連携</p>
                <p className="text-sm text-slate-700">{gmailAccounts.length}件のGmailアカウントを連携中</p>
              </Card>
            )}
          </>
        ) : (
          <Card>
            <p className="mb-1 text-sm font-medium text-slate-600">ログイン</p>
            <p className="mb-3 text-xs text-slate-400">ログインすると、他の端末とデータが同期されます。</p>
            <Button className="w-full" onClick={handleGoogleLogin}>
              Googleでログイン
            </Button>
          </Card>
        )}

        <Link to="/settings" className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
          <Card interactive className="flex items-center justify-between py-4">
            <span className="font-medium text-slate-900">設定を開く</span>
            <ChevronRight size={18} className="text-slate-300" />
          </Card>
        </Link>

        {isSupabaseConfigured && session && (
          <Button variant="danger" className="w-full" onClick={handleLogout}>
            ログアウト
          </Button>
        )}
      </div>
    </div>
  );
}
