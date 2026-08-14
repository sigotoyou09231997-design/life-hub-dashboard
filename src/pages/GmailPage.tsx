import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, CheckCircle2, Mail, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { db } from "../db/schema";
import type { SyncedEmail } from "../types";
import { GmailLogo } from "../components/gmail/GmailLogo";
import { Tabs } from "../components/ui/Tabs";
import { EmptyState } from "../components/ui/EmptyState";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { Sheet } from "../components/ui/Sheet";
import { GmailInbox, type GmailInboxHandle } from "../components/gmail/GmailInbox";
import { DraftReview } from "../components/gmail/DraftReview";
import { useToast } from "../components/ui/ToastProvider";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { useIsDesktop } from "../hooks/useIsDesktop";

const BACK_BUTTON_CLASS =
  "-ml-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

export default function GmailPage() {
  const navigate = useNavigate();
  const showToast = useToast();
  const accounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);
  const showSkeleton = useDelayedFlag(accounts === undefined);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<SyncedEmail | null>(null);
  const inboxRef = useRef<GmailInboxHandle>(null);
  const [syncing, setSyncing] = useState(false);
  const isDesktop = useIsDesktop();

  useEffect(() => {
    if (accounts && accounts.length > 0 && selectedAccountId == null) {
      setSelectedAccountId(accounts[0].id ?? null);
    }
  }, [accounts, selectedAccountId]);

  const selectedAccount = accounts?.find((a) => a.id === selectedAccountId);

  // Re-fetch the selected email's own row live (status/etc. can change under it,
  // e.g. after AI draft generation) rather than holding a stale snapshot.
  const selectedEmailLive = useLiveQuery(
    () => (selectedEmail?.id ? db.syncedEmails.get(selectedEmail.id) : undefined),
    [selectedEmail?.id],
  );
  const activeEmail = selectedEmailLive ?? selectedEmail;

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
              <div className="glass-mail-row flex items-center gap-2 rounded-full px-3.5 py-2.5">
                <span className="text-xs font-medium text-slate-600">自動下書き</span>
                {autoDraftToggle}
              </div>
              <button
                type="button"
                onClick={handleSyncClick}
                disabled={syncing}
                className="glass-mail-row flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-slate-600 transition-colors active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50"
              >
                <RefreshCw size={16} className={syncing ? "animate-spin motion-reduce:animate-none" : ""} />
                今すぐ同期
              </button>
              <button
                type="button"
                onClick={() => navigate("/settings")}
                className="glass-mail-row flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-slate-600 transition-colors active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
                  onChange={(v) => {
                    setSelectedAccountId(v);
                    setSelectedEmail(null);
                  }}
                  dense
                />
              </div>
            )}

            {selectedAccount && (
              // 3ペイン(左:一覧/中央:読む/右:AI返信案)は全て同じ高さの独立したガラスパネル。
              // lg以上では親(このページの残り高さ)いっぱいに伸び、各ペインの中だけがスクロールする
              // — 固定vh値をやめ、実際に割り当てられた高さから逆算する。
              <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(260px,0.85fr)_minmax(680px,2.15fr)] lg:items-stretch lg:gap-5">
                <GmailInbox
                  ref={inboxRef}
                  account={selectedAccount}
                  selectedEmailId={activeEmail?.id ?? null}
                  onSelectEmail={setSelectedEmail}
                />

                {/* デスクトップ: 右側に読む/返信ペインをインライン表示。
                    スマホ: 下からのSheetとして同じDraftReviewを表示(全面遷移にしない)。 */}
                <div className="mt-5 hidden h-full min-h-0 lg:mt-0 lg:block">
                  {activeEmail ? (
                    <DraftReview key={activeEmail.id} email={activeEmail} account={selectedAccount} variant="pane" />
                  ) : (
                    <div className="glass-pane flex h-full min-h-[420px] flex-col items-center justify-center gap-2 rounded-2xl p-8 text-center">
                      <Mail size={28} className="text-slate-300" />
                      <p className="text-sm text-slate-400">左のリストからメールを選択してください</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Sheet is mobile-only: on desktop the same DraftReview already renders
          inline as the right pane above, so opening it here too would stack a
          redundant overlay on top of it. */}
      {selectedAccount && !isDesktop && (
        <Sheet open={activeEmail !== null} onClose={() => setSelectedEmail(null)} title="メール詳細" reserveBottomBar compact>
          {activeEmail && (
            <DraftReview
              key={activeEmail.id}
              email={activeEmail}
              account={selectedAccount}
              onSent={() => setSelectedEmail(null)}
              variant="sheet"
            />
          )}
        </Sheet>
      )}
    </div>
  );
}
