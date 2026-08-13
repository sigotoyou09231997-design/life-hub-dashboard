import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Ban, Mail, RefreshCw, Search } from "lucide-react";
import { db } from "../../db/schema";
import type { EmailStatus, GmailAccount } from "../../types";
import { avatarColor, avatarInitial, ensureFreshAccessToken, getMessageMeta, listRecentMessageIds, parseSender } from "../../lib/gmail";
import { formatGmailTimestamp } from "../../lib/date";
import { unblockSenderRemote } from "../../lib/blockedSenders";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ListRow } from "../ui/ListRow";
import { ListSkeleton } from "../ui/ListSkeleton";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/ToastProvider";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";

interface Props {
  account: GmailAccount;
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

export function GmailInbox({ account }: Props) {
  const showToast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
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

  const visibleEmails = emails?.filter((email) => !blockedSet.has(parseSender(email.from).email.toLowerCase()));

  const filteredEmails = visibleEmails?.filter((email) => {
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
        await db.syncedEmails.add({
          accountId: account.id,
          gmailMessageId: id,
          threadId: meta.threadId,
          from: meta.from,
          subject: meta.subject,
          snippet: meta.snippet,
          receivedAt: meta.receivedAt,
          status: "unprocessed",
          createdAt: Date.now(),
        });
        added++;
      }
      await db.gmailAccounts.update(account.id, { lastSyncedAt: Date.now() });
      showToast(added > 0 ? `${added}件の新着メールを取得しました` : "新着メールはありませんでした");
    } catch {
      showToast("メールの取得に失敗しました", "error");
    } finally {
      setSyncing(false);
    }
  }

  // 画面を開いた瞬間に最新化する — 「同期」ボタンは以降の手動リフレッシュ用として残す。
  useEffect(() => {
    void handleSync();
  }, [account.id]);

  async function handleUnblock(id: string, email: string) {
    await db.blockedSenders.delete(id);
    void unblockSenderRemote(account.email, email);
    showToast("ブロックを解除しました");
  }

  return (
    <div className="space-y-3">
      <Button variant="secondary" className="w-full" onClick={handleSync} disabled={syncing}>
        <RefreshCw size={16} className={syncing ? "animate-spin motion-reduce:animate-none" : ""} />
        {syncing ? "同期中..." : "同期"}
      </Button>

      {!showSkeleton && emails && emails.length > 0 && (
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="送信者・件名・本文を検索"
            className="w-full rounded-xl border border-white/50 bg-white/40 py-2.5 pl-9 pr-3.5 text-sm outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
          />
        </div>
      )}

      {blockedSenders && blockedSenders.length > 0 && (
        <button
          type="button"
          onClick={() => setManageBlockedOpen(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <Ban size={13} />
          ブロック中の送信者({blockedSenders.length})
        </button>
      )}

      {showSkeleton ? (
        <ListSkeleton />
      ) : filteredEmails && filteredEmails.length > 0 ? (
        <div className="glass-card divide-y divide-white/40 overflow-hidden rounded-2xl">
          {filteredEmails.map((email) => {
            const sender = parseSender(email.from);
            const unread = email.status === "unprocessed";
            return (
              // A real anchor (not a button + window.open) so the browser's own new-tab
              // handling applies: cmd/ctrl-click, middle-click, and "open in new tab" all
              // work natively, and it isn't subject to popup-blocker heuristics.
              <a
                key={email.id}
                href={`/gmail/mail/${email.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(sender.email)}`}
                >
                  {avatarInitial(sender.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`truncate text-sm ${unread ? "font-semibold text-slate-900" : "font-medium text-slate-500"}`}>
                      {sender.name}
                    </p>
                    <span className="shrink-0 text-xs text-slate-400">{formatGmailTimestamp(email.receivedAt)}</span>
                  </div>
                  <p className={`mt-0.5 truncate text-sm ${unread ? "font-medium text-slate-800" : "text-slate-500"}`}>
                    {email.subject}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-400">{email.snippet}</p>
                  {email.status !== "unprocessed" && (
                    <div className="mt-1.5">
                      <Badge tone={STATUS_TONE[email.status]}>{STATUS_LABEL[email.status]}</Badge>
                    </div>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      ) : emails && emails.length > 0 ? (
        <EmptyState title="該当する結果が見つかりませんでした" description="検索条件を変えてみてください。" />
      ) : (
        <EmptyState
          icon={Mail}
          title="メールがありません"
          description="「同期」を押すと直近30日分の受信メールを取得します"
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
}
