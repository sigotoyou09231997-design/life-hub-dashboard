import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Ban, Mail, Search } from "lucide-react";
import { db } from "../../db/schema";
import type { EmailStatus, GmailAccount, SyncedEmail } from "../../types";
import {
  avatarColor,
  avatarInitial,
  ensureFreshAccessToken,
  generateDraftForEmail,
  getMessageMeta,
  listRecentMessageIds,
  parseSender,
} from "../../lib/gmail";
import { formatGmailTimestamp } from "../../lib/date";
import { unblockSenderRemote } from "../../lib/blockedSenders";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { ListRow } from "../ui/ListRow";
import { ListSkeleton } from "../ui/ListSkeleton";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/ToastProvider";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";

interface Props {
  account: GmailAccount;
  selectedEmailId: string | null;
  onSelectEmail: (email: SyncedEmail) => void;
}

/** Lets GmailPage's header "今すぐ同期" button trigger this component's own
 * sync logic (which needs account/blockedSet state that lives here) without
 * lifting that whole fetch flow up a level. */
export interface GmailInboxHandle {
  sync: () => void;
  syncing: boolean;
}

const SYNC_WINDOW_DAYS = 30;

const STATUS_LABEL: Record<EmailStatus, string> = {
  unprocessed: "未処理",
  generating: "生成中",
  drafted: "下書きあり",
  edited: "編集済み",
  sent: "送信済み",
  skipped: "スキップ",
};

const STATUS_TONE: Record<EmailStatus, "neutral" | "accent" | "warning" | "success"> = {
  unprocessed: "neutral",
  generating: "accent",
  drafted: "accent",
  edited: "warning",
  sent: "success",
  skipped: "neutral",
};

export const GmailInbox = forwardRef<GmailInboxHandle, Props>(function GmailInbox(
  { account, selectedEmailId, onSelectEmail },
  ref,
) {
  const showToast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "drafted" | "confirmed">("all");
  const [manageBlockedOpen, setManageBlockedOpen] = useState(false);

  const emails = useLiveQuery(
    () => (account.id ? db.syncedEmails.where("accountId").equals(account.id).reverse().sortBy("receivedAt") : []),
    [account.id],
  );
  const showSkeleton = useDelayedFlag(emails === undefined);

  const blockedSenders = useLiveQuery(
    () => (account.id ? db.blockedSenders.where("accountId").equals(account.id).toArray() : []),
    [account.id],
  );
  const blockedSet = new Set((blockedSenders ?? []).map((b) => b.email));

  // Separate from any notification/push setting — this only controls whether
  // handleSync() below also generates an AI draft for each newly-found email.
  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);
  const autoDraftEnabled = settings?.autoDraftEnabled ?? false;

  const visibleEmails = emails?.filter((email) => !blockedSet.has(parseSender(email.from).email.toLowerCase()));

  const statusFilteredEmails = visibleEmails?.filter((email) => {
    if (statusFilter === "drafted") return email.status === "drafted" || email.status === "edited";
    if (statusFilter === "confirmed") return email.status === "sent" || email.status === "skipped";
    return true;
  });

  const filteredEmails = statusFilteredEmails?.filter((email) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      email.from.toLowerCase().includes(q) ||
      email.subject.toLowerCase().includes(q) ||
      email.snippet.toLowerCase().includes(q)
    );
  });

  async function handleSync() {
    if (!account.id) return;
    setSyncing(true);
    try {
      const fresh = await ensureFreshAccessToken(account);
      const sinceEpochSec = Math.floor(Date.now() / 1000) - SYNC_WINDOW_DAYS * 24 * 60 * 60;
      const ids = await listRecentMessageIds(fresh.accessToken, sinceEpochSec);
      const existing = await db.syncedEmails.where("accountId").equals(account.id).toArray();
      const known = new Set(existing.map((e) => e.gmailMessageId));
      const newIds = ids.filter((id) => !known.has(id));

      let added = 0;
      for (const id of newIds) {
        const meta = await getMessageMeta(fresh.accessToken, id);
        if (blockedSet.has(parseSender(meta.from).email.toLowerCase())) continue;
        const newEmail = {
          accountId: account.id,
          gmailMessageId: id,
          threadId: meta.threadId,
          from: meta.from,
          subject: meta.subject,
          snippet: meta.snippet,
          receivedAt: meta.receivedAt,
          status: "unprocessed" as const,
          createdAt: Date.now(),
        };
        const newEmailId = await db.syncedEmails.add(newEmail);
        added++;

        // 自動下書き: 送信は行わない。draftReplies を作成するところまでで、
        // 送信は必ずDraftReview側で本人が「送信する」を押した場合のみ。
        if (autoDraftEnabled) {
          try {
            await generateDraftForEmail(account, { ...newEmail, id: newEmailId });
          } catch {
            // 同期自体は続行する — 個別メールの下書き生成失敗で全体を止めない。
          }
        }
      }
      await db.gmailAccounts.update(account.id, { lastSyncedAt: Date.now() });
      showToast(added > 0 ? `${added}件の新着メールを取得しました` : "新着メールはありませんでした");
    } catch {
      showToast("メールの取得に失敗しました", "error");
    } finally {
      setSyncing(false);
    }
  }

  useImperativeHandle(ref, () => ({ sync: handleSync, syncing }), [syncing, account, blockedSet]);

  // 画面を開いた瞬間に最新化する — ヘッダーの「今すぐ同期」は以降の手動リフレッシュ用として残す。
  useEffect(() => {
    void handleSync();
  }, [account.id]);

  async function handleUnblock(id: string, email: string) {
    await db.blockedSenders.delete(id);
    void unblockSenderRemote(account.email, email);
    showToast("ブロックを解除しました");
  }

  return (
    // 1本の独立したガラスパネル(左ペイン)。lg以上は高さを親グリッドに合わせて固定し、
    // リスト部分だけが内部スクロールする(検索・タブ・ブロック中リンクは常に見える)。
    // lg未満(モバイル)はflex-colのまま自然に積み重なり、ページ全体でスクロールする。
    <div className="glass-pane flex flex-col gap-3 rounded-2xl p-4 lg:h-full lg:min-h-0">
      {!showSkeleton && emails && emails.length > 0 && (
        <div className="relative shrink-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="メールを検索"
            className="w-full rounded-xl border border-white/50 bg-white/40 py-2.5 pl-9 pr-3.5 text-sm outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
          />
        </div>
      )}

      {!showSkeleton && emails && emails.length > 0 && (
        <div className="flex shrink-0 gap-1.5" role="group" aria-label="ステータスフィルター">
          {(
            [
              ["all", "すべて"],
              ["drafted", "AI下書き"],
              ["confirmed", "確認済み"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              aria-pressed={statusFilter === value}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                statusFilter === value
                  ? "border-accent bg-accent-light text-accent"
                  : "border-white/50 text-slate-500 hover:border-white/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {blockedSenders && blockedSenders.length > 0 && (
        <button
          type="button"
          onClick={() => setManageBlockedOpen(true)}
          className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <Ban size={13} />
          ブロック中の送信者({blockedSenders.length})
        </button>
      )}

      {showSkeleton ? (
        <ListSkeleton />
      ) : filteredEmails && filteredEmails.length > 0 ? (
        <div className="flex flex-col gap-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-0.5">
          {filteredEmails.map((email) => {
            const sender = parseSender(email.from);
            const unread = email.status === "unprocessed";
            const selected = email.id === selectedEmailId;
            return (
              <button
                key={email.id}
                type="button"
                onClick={() => onSelectEmail(email)}
                aria-pressed={selected}
                className={`glass-mail-row flex w-full items-start gap-3 rounded-xl border-l-[3px] px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${
                  selected ? "border-l-accent bg-accent-light/50" : "border-l-transparent active:bg-white/60"
                }`}
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(sender.email)}`}
                >
                  {avatarInitial(sender.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`truncate text-sm ${unread ? "font-semibold text-slate-900" : "font-medium text-slate-600"}`}>
                      {sender.name}
                    </p>
                    <span className="shrink-0 text-xs text-slate-500">{formatGmailTimestamp(email.receivedAt)}</span>
                  </div>
                  <p className={`mt-0.5 truncate text-sm ${unread ? "font-medium text-slate-800" : "text-slate-600"}`}>
                    {email.subject}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{email.snippet}</p>
                  {email.status !== "unprocessed" && (
                    <div className="mt-1.5">
                      <Badge tone={STATUS_TONE[email.status]}>{STATUS_LABEL[email.status]}</Badge>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ) : emails && emails.length > 0 ? (
        <EmptyState title="該当する結果が見つかりませんでした" description="検索条件を変えてみてください。" />
      ) : (
        <EmptyState
          icon={Mail}
          title="メールがありません"
          description="「今すぐ同期」を押すと直近30日分の受信メールを取得します"
        />
      )}

      <Sheet open={manageBlockedOpen} onClose={() => setManageBlockedOpen(false)} title="ブロック中の送信者">
        <div className="space-y-2">
          {(blockedSenders ?? []).map((b) => (
            <ListRow key={b.id} className="flex items-center justify-between py-2.5">
              <span className="min-w-0 truncate text-sm text-slate-700">{b.email}</span>
              <button
                type="button"
                onClick={() => b.id && handleUnblock(b.id, b.email)}
                className="shrink-0 text-xs font-medium text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
              >
                解除
              </button>
            </ListRow>
          ))}
        </div>
      </Sheet>
    </div>
  );
});
