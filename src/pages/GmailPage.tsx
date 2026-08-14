import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, CheckCircle2, Mail, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { db } from "../db/schema";
import { GmailLogo } from "../components/gmail/GmailLogo";
import { Tabs } from "../components/ui/Tabs";
import { EmptyState } from "../components/ui/EmptyState";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { GmailInbox, type GmailInboxHandle } from "../components/gmail/GmailInbox";
import { useToast } from "../components/ui/ToastProvider";
import { useDelayedFlag } from "../hooks/useDelayedFlag";

const BACK_BUTTON_CLASS =
  "-ml-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

export default function GmailPage() {
  const navigate = useNavigate();
  const showToast = useToast();
  const accounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);
  const showSkeleton = useDelayedFlag(accounts === undefined);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const inboxRef = useRef<GmailInboxHandle>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (accounts && accounts.length > 0 && selectedAccountId == null) {
      setSelectedAccountId(accounts[0].id ?? null);
    }
  }, [accounts, selectedAccountId]);

  const selectedAccount = accounts?.find((a) => a.id === selectedAccountId);

  // 「自動下書き」＝新着メール同期時にAI下書きを自動生成するかどうか。
  // 通知(プッシュ)設定とは別のsettings.autoDraftEnabledを使う — 同じ値を共有しない。
  // 送信は行わない: これをONにしても、送信は必ずDraftReview側で本人が
  // 「送信する」を押した場合のみ実行される。
  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);
  const autoDraftEnabled = settings?.autoDraftEnabled ?? false;

  async function handleToggleAutoDraft(next: boolean) {
    if (!settings?.id) return;
    await db.settings.update(settings.id, { autoDraftEnabled: next });
    showToast(next ? "自動下書きを有効にしました" : "自動下書きを無効にしました");
  }

  async function handleSyncClick() {
    setSyncing(true);
    try {
      await inboxRef.current?.sync();
    } finally {
      setSyncing(false);
    }
  }

  const autoDraftToggle = (
    <button
      type="button"
      onClick={() => handleToggleAutoDraft(!autoDraftEnabled)}
      aria-pressed={autoDraftEnabled}
      aria-label="自動下書きを切り替え"
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 ${
        autoDraftEnabled ? "bg-accent" : "bg-slate-300"
      }`}
    >
      <span
        className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          autoDraftEnabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );

  return (
    <div className="pb-10 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:pb-0">
      <div className="flex items-center justify-between gap-2 px-5 pb-4 pt-6 lg:shrink-0">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => navigate("/")} aria-label="戻る" className={BACK_BUTTON_CLASS}>
            <ChevronLeft size={22} />
          </button>
          <GmailLogo size={22} />
          <h1 className="truncate text-xl font-bold text-slate-900">Gmail自動返信</h1>
          {selectedAccount && (
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 size={14} />
              同期済み
            </span>
          )}
        </div>

        {selectedAccount && (
          <>
            {/* PC: 参考画像どおり、文字ラベル付きのガラスボタン(44px以上)を並べる */}
            <div className="hidden items-center gap-2.5 lg:flex">
              <div className="glass-row flex items-center gap-2 rounded-full px-3.5 py-2.5">
                <span className="text-xs font-medium text-slate-600">自動下書き</span>
                {autoDraftToggle}
              </div>
              <button
                type="button"
                onClick={handleSyncClick}
                disabled={syncing}
                className="glass-row flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-slate-600 transition-colors active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50"
              >
                <RefreshCw size={16} className={syncing ? "animate-spin motion-reduce:animate-none" : ""} />
                今すぐ同期
              </button>
              <button
                type="button"
                onClick={() => navigate("/settings")}
                className="glass-row flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-slate-600 transition-colors active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <SettingsIcon size={16} />
                設定
              </button>
            </div>

            {/* スマホ/タブレット: タイトルと同じ行に収める。Gmail設定は共通ヘッダーの
                設定アイコンから開けるため、ここでは重複させない(今すぐ同期のみ)。 */}
            <div className="flex shrink-0 items-center gap-2 lg:hidden">
              <div className="hidden items-center gap-2 sm:flex">
                <span className="text-xs font-medium text-slate-500">自動下書き</span>
                {autoDraftToggle}
              </div>
              <button
                type="button"
                onClick={handleSyncClick}
                disabled={syncing}
                aria-label="今すぐ同期"
                className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50"
              >
                <RefreshCw size={18} className={syncing ? "animate-spin motion-reduce:animate-none" : ""} />
              </button>
            </div>
          </>
        )}
      </div>

      <div className="px-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        {showSkeleton ? (
          <ListSkeleton />
        ) : !accounts || accounts.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="Gmail未接続"
            description="設定画面からGmailアカウントを連携してください"
            action={{ label: "設定を開く", onClick: () => navigate("/settings") }}
          />
        ) : (
          <>
            {accounts.length > 1 && (
              <div className="mb-4">
                <Tabs
                  options={accounts.map((a) => ({ value: String(a.id), label: a.email }))}
                  value={selectedAccountId ?? ""}
                  onChange={(v) => setSelectedAccountId(v)}
                  dense
                />
              </div>
            )}

            {selectedAccount && (
              // メールは行クリックで /gmail/mail/:id を新規タブで開く(GmailInbox.tsx)ため、
              // ここには一覧ペイン1つだけを幅いっぱいに表示する。
              <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
                <GmailInbox ref={inboxRef} account={selectedAccount} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
