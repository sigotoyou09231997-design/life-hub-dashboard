import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Mail, RefreshCw } from "lucide-react";
import { db } from "../../db/schema";
import type { EmailStatus, GmailAccount, SyncedEmail } from "../../types";
import { avatarColor, avatarInitial, ensureFreshAccessToken, getMessageMeta, listRecentMessageIds, parseSender } from "../../lib/gmail";
import { formatGmailTimestamp } from "../../lib/date";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/ListSkeleton";
import { useToast } from "../ui/ToastProvider";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";

interface Props {
  account: GmailAccount;
  onOpenEmail: (email: SyncedEmail) => void;
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

export function GmailInbox({ account, onOpenEmail }: Props) {
  const showToast = useToast();
  const [syncing, setSyncing] = useState(false);

  const emails = useLiveQuery(
    () => (account.id ? db.syncedEmails.where("accountId").equals(account.id).reverse().sortBy("receivedAt") : []),
    [account.id],
  );
  const showSkeleton = useDelayedFlag(emails === undefined);

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

  return (
    <div className="space-y-3">
      <Button variant="secondary" className="w-full" onClick={handleSync} disabled={syncing}>
        <RefreshCw size={16} className={syncing ? "animate-spin motion-reduce:animate-none" : ""} />
        {syncing ? "同期中..." : "同期"}
      </Button>

      {showSkeleton ? (
        <ListSkeleton />
      ) : emails && emails.length > 0 ? (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
          {emails.map((email) => {
            const sender = parseSender(email.from);
            const unread = email.status === "unprocessed";
            return (
              <button
                key={email.id}
                type="button"
                onClick={() => onOpenEmail(email)}
                className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
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
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Mail}
          title="メールがありません"
          description="「同期」を押すと直近30日分の受信メールを取得します"
        />
      )}
    </div>
  );
}
