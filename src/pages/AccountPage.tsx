import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { Session } from "@supabase/auth-js";
import { RefreshCw, Check, ChevronRight, Cloud, Mail, UserPlus, UserRound, Users } from "lucide-react";
import { db } from "../db/schema";
import { auth, isSupabaseConfigured, getRedirectUri } from "../lib/supabase";
import { listAccounts } from "../lib/accounts";
import { signOutActiveAccount, startAddAccount, switchToAccount } from "../lib/accountSwitch";
import { syncNow } from "../lib/syncRuntime";
import { AccountAvatar, accountLabel } from "../components/layout/AccountSwitcher";
import { avatarColor, avatarInitial } from "../lib/gmail";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/ToastProvider";
import { ConnectedApps } from "../components/account/ConnectedApps";
import { IS_DEMO } from "../lib/demoMode";
import { DEMO_GMAIL_ADDRESS } from "../lib/demoMail";

/** デモ(/demo)で見せる見本の人(2026-11-27)。ログインしていない「利用不可」の画面を見せないため。本物のログインはしない。 */
const DEMO_PERSON = { name: "デモ ユーザー", email: DEMO_GMAIL_ADDRESS };

/** Identity + app-login screen, reached from the header's avatar. Deliberately
 * narrow in scope: profile photo/name/email, app login state, login/logout,
 * and a link into Settings — Gmail account add/remove and its own connection
 * management stay in Settings so there's exactly one place that owns each. */
export default function AccountPage() {
  const showToast = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [syncing, setSyncing] = useState(false);
  const gmailAccounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);
  // 端末に登録済みのアプリのアカウント一覧。切り替えるとページごと開き直すので、
  // 画面が生きている間に変わることはない。
  const accounts = listAccounts();

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
    // ログアウトはいま開いているアカウントだけ。他に登録済みのアカウントがあれば
    // そちらに切り替わって開き直す(src/lib/accountSwitch.ts)。
    await signOutActiveAccount();
    showToast("ログアウトしました");
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const summary = await syncNow();
      showToast(summary);
    } catch (err) {
      // 機械のエラー文はお知らせに出さず、記録だけ残す(2026-11-09、参考 @rrr_craft「UXライティング」②読み手の言葉で)。
      console.error("[sync] manual sync failed:", err);
      showToast("同期できませんでした。通信を確かめてもう一度お試しください", "error");
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
            <div className="system-section__identity"><span><UserRound size={17} /></span><div><h2>プロフィール</h2><p className="brand-tagline">LIFE HUB — くらしを、ひとつに。</p></div></div>
            <div className={`system-status ${session || IS_DEMO ? "is-online" : ""}`}><i />{IS_DEMO ? "ログイン中(デモ)" : !isSupabaseConfigured ? "利用不可" : session ? "ログイン中" : "未ログイン"}</div>
          </div>
          <div className="profile-identity-content">
            {IS_DEMO ? (
              <>
                <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white ${avatarColor(DEMO_PERSON.name)}`}>
                  {avatarInitial(DEMO_PERSON.name)}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{DEMO_PERSON.name}</p>
                  <p className="truncate text-sm text-slate-500">{DEMO_PERSON.email}</p>
                  <p className="mt-1 text-xs text-success">見本のアカウントでログインしています(デモ)</p>
                </div>
              </>
            ) : session ? (
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

        {isSupabaseConfigured && accounts.length > 0 && (
          <Card className="lg:col-span-2">
            <div className="profile-module__header">
              <div className="system-section__identity"><span><Users size={17} /></span><div><h2>この端末のアカウント</h2></div></div>
            </div>
            <p className="profile-module__description text-xs text-slate-500">
              複数のアカウントを登録しておくと、ヘッダーのアイコンからワンタップで切り替えられます。
              データはアカウントごとに端末内で分かれているので、切り替えても消えません。
            </p>
            <div className="mt-3 space-y-2">
              {accounts.map((account) => {
                const isActive = account.userId === session?.user.id;
                return (
                  <div key={account.userId} className="glass-row flex items-center gap-3 rounded-xl p-3">
                    <AccountAvatar account={account} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{accountLabel(account)}</p>
                      <p className="truncate text-xs text-slate-500">{account.email ?? "—"}</p>
                    </div>
                    {isActive ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success">
                        <Check size={15} />
                        使用中
                      </span>
                    ) : (
                      <Button variant="secondary" onClick={() => switchToAccount(account.userId)}>
                        切り替え
                      </Button>
                    )}
                  </div>
                );
              })}
              <Button variant="secondary" className="w-full" onClick={startAddAccount}>
                <UserPlus size={16} />
                アカウントを追加
              </Button>
            </div>
          </Card>
        )}

        <Card className="profile-sync-module">
          <div className="profile-module__header">
            <div className="system-section__identity"><span><Cloud size={17} /></span><div><h2>端末間同期</h2></div></div>
          </div>
          <p className="profile-module__description text-xs text-slate-500">
            {session || IS_DEMO ? "お金管理・予定・タスクなどを、ログインした端末同士で同期します。" : "ログイン後に、端末間のリアルタイム同期を利用できます。"}
          </p>
          <div className="profile-state-row"><span>現在の状態</span><strong>{IS_DEMO ? "同期オン" : session ? "同期可能" : isSupabaseConfigured ? "ログインが必要" : "未設定"}</strong></div>
          {IS_DEMO && <p className="mt-2 text-xs text-slate-500">デモでは、見本のデータをこの端末の中だけで動かしています(ほかの端末へは送りません)。</p>}
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
            <div className="system-section__identity"><span><Mail size={17} /></span><div><h2>Gmail</h2></div></div>
          </div>
          <p className="profile-module__description text-xs text-slate-500">受信メールとAI返信案の接続状態です。管理は設定画面から行えます。</p>
          <div className="profile-state-row"><span>連携中のアカウント</span><strong>{gmailAccounts === undefined ? "確認中" : `${gmailAccounts.length}件`}</strong></div>
        </Card>

        {isSupabaseConfigured && session && <ConnectedApps />}

        <Link to="/settings" className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 lg:col-span-2">
          <Card interactive className="flex items-center justify-between py-4">
            <span className="font-medium text-slate-900">設定を開く</span>
            <ChevronRight size={18} className="text-slate-300" />
          </Card>
        </Link>

        {isSupabaseConfigured && session && (
          // 幅いっぱいの薄赤の帯はやめ、右下の小さな文字リンクに(第8弾 AC-1)。押す時だけ赤。
          <div className="account-logout lg:col-span-2">
            <button type="button" className="account-logout__link" onClick={handleLogout}>
              ログアウト
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
