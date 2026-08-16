import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { Session } from "@supabase/auth-js";
import { RefreshCw, ChevronRight, Cloud, Mail, UserRound } from "lucide-react";
import { db } from "../db/schema";
import { auth, isSupabaseConfigured, getRedirectUri } from "../lib/supabase";
import { syncNow } from "../lib/syncRuntime";
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
    auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleGoogleLogin() {
    await auth.signInWithOAuth({ provider: "google", options: { redirectTo: getRedirectUri() } });
  }

  async function handleLogout() {
    await auth.signOut();
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
    <div className="spatial-page account-page micro-contrast mx-auto max-w-[900px] pb-10 lg:pb-8">
      <PageHeader title="アカウント" backTo="/" />

      <div className="profile-control-panel settings-account-grid grid gap-3 px-5 lg:grid-cols-2 lg:px-8 lg:pt-1">
        <Card className="profile-identity-module lg:col-span-2">
          <div className="profile-module__header">
            <div><span>Identity</span><h2>プロフィール</h2></div>
            <div className={`system-status ${session ? "is-online" : ""}`}><i />{!isSupabaseConfigured ? "UNAVAILABLE" : session ? "SIGNED IN" : "SIGNED OUT"}</div>
          </div>
          <div className="profile-identity-content">
            {session ? (
              <>
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
              </>
            ) : (
              <>
                <div className="profile-placeholder-avatar"><UserRound size={22} /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800">{isSupabaseConfigured ? "ログインしていません" : "アカウント利用不可"}</p>
                  <p className="mt-1 text-sm text-slate-500">{isSupabaseConfigured ? "Googleアカウントでログインすると端末間同期を利用できます。" : "この環境にはアカウント接続情報が設定されていません。"}</p>
                </div>
                {isSupabaseConfigured && <Button className="profile-identity-login" onClick={handleGoogleLogin}>Googleでログイン</Button>}
              </>
            )}
          </div>
        </Card>

        <Card className="profile-sync-module">
          <div className="profile-module__header">
            <div><span>Sync</span><h2>端末間同期</h2></div>
            <Cloud size={17} />
          </div>
          <p className="profile-module__description text-xs text-slate-500">
            {session ? "お金管理・予定・タスクなどを、ログインした端末同士で同期します。" : "ログイン後に、端末間のリアルタイム同期を利用できます。"}
          </p>
          <div className="profile-state-row"><span>Current status</span><strong>{session ? "同期可能" : isSupabaseConfigured ? "ログインが必要" : "未設定"}</strong></div>
          {session && (
            <div className="profile-module__actions">
              <Button variant="secondary" className="w-full" onClick={handleSync} disabled={syncing}>
                <RefreshCw size={16} className={syncing ? "animate-spin motion-reduce:animate-none" : ""} />
                {syncing ? "同期中..." : "今すぐ同期"}
              </Button>
            </div>
          )}
        </Card>

        <Card className="profile-gmail-module">
          <div className="profile-module__header">
            <div><span>Connectivity</span><h2>Gmail</h2></div>
            <Mail size={17} />
          </div>
          <p className="profile-module__description text-xs text-slate-500">受信メールとAI返信案の接続状態です。管理は設定画面から行えます。</p>
          <div className="profile-state-row"><span>Connected accounts</span><strong>{gmailAccounts === undefined ? "確認中" : `${gmailAccounts.length}件`}</strong></div>
        </Card>

        <Link to="/settings" className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 lg:col-span-2">
          <Card interactive className="flex items-center justify-between py-4">
            <span className="font-medium text-slate-900">設定を開く</span>
            <ChevronRight size={18} className="text-slate-300" />
          </Card>
        </Link>

        {isSupabaseConfigured && session && (
          <Button variant="danger" className="w-full lg:col-span-2" onClick={handleLogout}>
            ログアウト
          </Button>
        )}
      </div>
    </div>
  );
}
