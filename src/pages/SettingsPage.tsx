import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { Session } from "@supabase/supabase-js";
import { ChevronRight } from "lucide-react";
import { db, ensureDefaultSettings } from "../db/schema";
import type { GmailAccount } from "../types";
import { requestNotificationPermission, isNotificationSupported } from "../lib/notifications";
import { exportBackup, importBackup } from "../lib/backup";
import { startGmailOAuth } from "../lib/gmail";
import { isSupabaseConfigured, supabase, getRedirectUri } from "../lib/supabase";
import { isPushConfigured, getPushSubscription, subscribeToPush, unsubscribeFromPush } from "../lib/pushNotifications";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { ListRow } from "../components/ui/ListRow";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/ToastProvider";

export default function SettingsPage() {
  const showToast = useToast();

  useEffect(() => {
    ensureDefaultSettings();
  }, []);

  const [session, setSession] = useState<Session | null>(null);

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

  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);
  const gmailAccounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);
  const initialized = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission | null>(null);

  useEffect(() => {
    if (settings && !initialized.current) {
      initialized.current = true;
      setNotificationsEnabled(settings.notificationsEnabled);
    }
  }, [settings]);

  useEffect(() => {
    if (isNotificationSupported()) setPermissionStatus(Notification.permission);
  }, []);

  // The browser can block notifications outside the app (its own site settings) after the
  // toggle was already on — reconcile the stored flag with live permission so the switch
  // never shows "on" while notifications can't actually fire.
  useEffect(() => {
    if (permissionStatus === "denied" && notificationsEnabled && settings?.id) {
      setNotificationsEnabled(false);
      db.settings.update(settings.id, { notificationsEnabled: false });
    }
  }, [permissionStatus, notificationsEnabled, settings?.id]);

  const notificationsBlocked = permissionStatus === "denied";
  const notificationsOn = notificationsEnabled && !notificationsBlocked;

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    if (!isPushConfigured) return;
    getPushSubscription().then((sub) => setPushEnabled(Boolean(sub)));
  }, []);

  async function handleTogglePush(next: boolean) {
    if (!session || !gmailAccounts || gmailAccounts.length === 0 || pushBusy) return;
    setPushBusy(true);
    try {
      if (next) {
        await subscribeToPush(gmailAccounts, session.user.id);
        setPushEnabled(true);
        showToast("バックグラウンド通知を有効にしました");
      } else {
        await unsubscribeFromPush();
        setPushEnabled(false);
        showToast("バックグラウンド通知を無効にしました");
      }
    } catch {
      showToast("通知の設定に失敗しました", "error");
    } finally {
      setPushBusy(false);
    }
  }

  async function handleToggleNotifications(next: boolean) {
    if (notificationsBlocked) return;
    setNotificationsEnabled(next);
    if (!settings?.id) return;
    if (next) {
      const permission = await requestNotificationPermission();
      setPermissionStatus(permission);
      const granted = permission === "granted";
      await db.settings.update(settings.id, { notificationsEnabled: granted });
      if (!granted) setNotificationsEnabled(false);
    } else {
      await db.settings.update(settings.id, { notificationsEnabled: false });
    }
  }

  async function handleExport() {
    try {
      await exportBackup();
      showToast("バックアップを書き出しました");
    } catch {
      showToast("書き出しに失敗しました", "error");
    }
  }

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm("現在のデータをすべて置き換えて復元します。よろしいですか?")) {
      e.target.value = "";
      return;
    }
    try {
      await importBackup(file);
      showToast("データを復元しました");
    } catch {
      showToast("復元に失敗しました。ファイルの形式を確認してください。", "error");
    } finally {
      e.target.value = "";
    }
  }

  async function handleDisconnectGmail(account: GmailAccount) {
    // Best-effort — Google's revoke endpoint doesn't need the client secret, so it's safe to call from the browser.
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `token=${encodeURIComponent(account.refreshToken)}`,
      });
    } catch {
      // ignore — we still remove the local account below
    }
    if (session) {
      // best-effort — stops background push polling for this account; a missed delete
      // just means checkGmailAndNotify.ts keeps polling with an access token that will
      // start failing anyway once Google's revoke above takes effect.
      try {
        await supabase.from("gmail_server_accounts").delete().eq("user_id", session.user.id).eq("email", account.email);
      } catch {
        // ignore
      }
    }
    if (account.id == null) return;
    const accountId = account.id;
    await db.transaction("rw", [db.gmailAccounts, db.syncedEmails, db.draftReplies], async () => {
      await db.draftReplies.where("accountId").equals(accountId).delete();
      await db.syncedEmails.where("accountId").equals(accountId).delete();
      await db.gmailAccounts.delete(accountId);
    });
    showToast("Gmail連携を解除しました");
  }

  return (
    <div className="pb-10">
      <PageHeader title="設定" backTo="/" />

      <div className="space-y-4 px-5">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-600">通知</p>
              <p className="mt-0.5 text-xs text-slate-400">アプリを開いている間のみ通知が届きます</p>
            </div>
            <button
              onClick={() => handleToggleNotifications(!notificationsEnabled)}
              aria-pressed={notificationsOn}
              aria-label="通知を切り替え"
              disabled={notificationsBlocked}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                notificationsOn ? "bg-accent" : "bg-slate-200"
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  notificationsOn ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          {notificationsBlocked && (
            <p className="mt-2 text-xs text-danger">
              ブラウザの通知がブロックされています。ブラウザの設定から許可してください。
            </p>
          )}
        </Card>

        <Card>
          <p className="mb-1 text-sm font-medium text-slate-600">データ管理</p>
          <p className="mb-3 text-xs text-slate-400">
            すべてのデータは端末内にのみ保存されています。バックアップを取っておくと安心です。
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={handleExport}>
              書き出す
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => fileInputRef.current?.click()}>
              復元する
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleImport}
              className="hidden"
            />
          </div>
        </Card>

        {isSupabaseConfigured && (
          <Card>
            <p className="mb-1 text-sm font-medium text-slate-600">アカウント連携(PC/スマホ同期)</p>
            <p className="mb-3 text-xs text-slate-400">
              ログインした端末同士で、お金管理のデータがリアルタイムに同期されます。
            </p>
            {session ? (
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-slate-700">{session.user.email}</span>
                <Button variant="secondary" onClick={handleLogout}>
                  ログアウト
                </Button>
              </div>
            ) : (
              <Button variant="secondary" className="w-full" onClick={handleGoogleLogin}>
                Googleでログイン
              </Button>
            )}
          </Card>
        )}

        <Card>
          <p className="mb-1 text-sm font-medium text-slate-600">Gmail連携</p>
          <p className="mb-3 text-xs text-slate-400">
            受信メールにAIが返信案を作成します。
            {!pushEnabled && "連携情報はこの端末にのみ保存されます。"}
          </p>
          {gmailAccounts && gmailAccounts.length > 0 && (
            <div className="mb-3 space-y-2">
              {gmailAccounts.map((account) => (
                <ListRow key={account.id} className="flex items-center justify-between py-2.5">
                  <span className="truncate text-sm text-slate-700">{account.email}</span>
                  <button
                    onClick={() => handleDisconnectGmail(account)}
                    className="shrink-0 text-xs font-medium text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                  >
                    解除
                  </button>
                </ListRow>
              ))}
            </div>
          )}
          <Button variant="secondary" className="w-full" onClick={startGmailOAuth}>
            {gmailAccounts && gmailAccounts.length > 0 ? "+ アカウントを追加" : "連携する"}
          </Button>

          {isSupabaseConfigured && isPushConfigured && session && gmailAccounts && gmailAccounts.length > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <div>
                <p className="text-sm text-slate-700">バックグラウンド通知</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  アプリを閉じていても新着メールを通知します(refresh tokenをサーバーにも保存します)
                </p>
              </div>
              <button
                onClick={() => handleTogglePush(!pushEnabled)}
                aria-pressed={pushEnabled}
                aria-label="バックグラウンド通知を切り替え"
                disabled={pushBusy}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  pushEnabled ? "bg-accent" : "bg-slate-200"
                }`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    pushEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          )}
        </Card>

        {gmailAccounts && gmailAccounts.length > 0 && (
          <Link to="/gmail" className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
            <Card interactive className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium text-slate-900">メールを見る</p>
                <p className="mt-0.5 text-xs text-slate-400">受信メールとAI下書き</p>
              </div>
              <ChevronRight size={18} className="text-slate-300" />
            </Card>
          </Link>
        )}

        <Link to="/records" className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
          <Card interactive className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium text-slate-900">以前のデータ</p>
              <p className="mt-0.5 text-xs text-slate-400">日記・目標・習慣(新しいメニューには表示されません)</p>
            </div>
            <ChevronRight size={18} className="text-slate-300" />
          </Card>
        </Link>
      </div>
    </div>
  );
}
