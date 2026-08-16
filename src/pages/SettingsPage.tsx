import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Session } from "@supabase/auth-js";
import { Database, Mail } from "lucide-react";
import { db, ensureDefaultSettings } from "../db/schema";
import type { GmailAccount } from "../types";
import { exportBackup, importBackup } from "../lib/backup";
import { startGmailOAuth } from "../lib/gmail";
import { auth, isSupabaseConfigured } from "../lib/supabase";
import { getSupabaseDataClient } from "../lib/supabaseData";
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
    auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  const gmailAccounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        const supabase = await getSupabaseDataClient();
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
    <div className="spatial-page settings-page micro-contrast mx-auto max-w-[1040px] pb-10 lg:pb-8">
      <PageHeader title="設定" backTo="/" />

      <div className="system-control-panel settings-account-grid grid gap-3 px-5 lg:grid-cols-2 lg:px-8 lg:pt-1">
        <Card className="system-section system-section--data">
          <div className="system-section__header">
            <div className="system-section__identity"><span><Database size={17} /></span><div><p>System</p><h2>データ管理</h2></div></div>
            <div className="system-status is-online"><i />{session ? "LOCAL + SYNC" : "LOCAL"}</div>
          </div>
          <p className="system-section__description text-xs text-slate-500">
            すべてのデータは端末内にのみ保存されています。バックアップを取っておくと安心です。
          </p>
          <div className="system-state-control">
            <div><span>Storage</span><strong>{session ? "この端末 + 同期" : "この端末"}</strong></div>
            <small>{session ? "同期可能" : "Local only"}</small>
          </div>
          <div className="system-section__actions flex gap-3">
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

        <Card className="system-section system-section--gmail">
          <div className="system-section__header">
            <div className="system-section__identity"><span><Mail size={17} /></span><div><p>Connectivity</p><h2>Gmail</h2></div></div>
            <div className={`system-status ${gmailAccounts && gmailAccounts.length > 0 ? "is-online" : ""}`}><i />{gmailAccounts === undefined ? "CHECKING" : gmailAccounts.length > 0 ? "CONNECTED" : "NOT CONNECTED"}</div>
          </div>
          <p className="system-section__description text-xs text-slate-500">
            受信メールにAIが返信案を作成します。
            {!pushEnabled && "連携情報はこの端末にのみ保存されます。"}
          </p>
          <div className="system-state-control">
            <div><span>Connection</span><strong>{gmailAccounts && gmailAccounts.length > 0 ? `${gmailAccounts.length} アカウント` : "未接続"}</strong></div>
            <small>{gmailAccounts && gmailAccounts.length > 0 ? "AI reply ready" : "AI reply unavailable"}</small>
          </div>
          {gmailAccounts && gmailAccounts.length > 0 && (
            <div className="system-account-list space-y-2">
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
          <div className="system-section__actions">
            <Button variant="secondary" className="w-full" onClick={startGmailOAuth}>
              {gmailAccounts && gmailAccounts.length > 0 ? "+ アカウントを追加" : "連携する"}
            </Button>
          </div>

          {isSupabaseConfigured && isPushConfigured && session && gmailAccounts && gmailAccounts.length > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/40 pt-3">
              <div>
                <p className="text-sm text-slate-700">バックグラウンド通知</p>
                <p className="mt-0.5 text-xs text-slate-500">
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
                  className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    pushEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
