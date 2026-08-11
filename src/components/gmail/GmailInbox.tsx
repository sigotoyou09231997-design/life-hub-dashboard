import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Mail, RefreshCw } from "lucide-react";
import { db } from "../../db/schema";
import type { EmailStatus, GmailAccount, SyncedEmail } from "../../types";
import { ensureFreshAccessToken, generateDraftForEmail, getMessageMeta, listRecentMessageIds } from "../../lib/gmail";
import { ListRow } from "../ui/ListRow";
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
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [generatingBulk, setGeneratingBulk] = useState(false);

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

  async function generateForEmail(email: SyncedEmail) {
    try {
      await generateDraftForEmail(account, email);
    } catch {
      showToast(`「${email.subject}」の下書き作成に失敗しました`, "error");
    }
  }

  async function handleGenerateSelected() {
    if (!emails) return;
    setGeneratingBulk(true);
    try {
      const targets = emails.filter((e) => e.id != null && selected.has(e.id));
      for (const email of targets) {
        await generateForEmail(email);
      }
      setSelected(new Set());
    } finally {
      setGeneratingBulk(false);
    }
  }

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <Button variant="secondary" className="w-full" onClick={handleSync} disabled={syncing}>
        <RefreshCw size={16} className={syncing ? "animate-spin motion-reduce:animate-none" : ""} />
        {syncing ? "同期中..." : "同期"}
      </Button>

      {selected.size > 0 && (
        <Button className="w-full" onClick={handleGenerateSelected} disabled={generatingBulk}>
          {generatingBulk ? "生成中..." : `選択した${selected.size}件にAI下書きを作成`}
        </Button>
      )}

      {showSkeleton ? (
        <ListSkeleton />
      ) : emails && emails.length > 0 ? (
        <div className="space-y-2">
          {emails.map((email) => (
            <ListRow key={email.id} className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={!!email.id && selected.has(email.id)}
                onChange={() => email.id != null && toggleSelected(email.id)}
                aria-label={`「${email.subject}」を選択`}
                className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-accent focus:ring-accent"
              />
              <button type="button" onClick={() => onOpenEmail(email)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-900">{email.from}</p>
                  <Badge tone={STATUS_TONE[email.status]}>{STATUS_LABEL[email.status]}</Badge>
                </div>
                <p className="mt-0.5 truncate text-sm text-slate-700">{email.subject}</p>
                <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">{email.snippet}</p>
              </button>
              {email.status === "unprocessed" && (
                <button
                  type="button"
                  onClick={() => generateForEmail(email)}
                  className="shrink-0 self-center text-xs font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  AI下書き
                </button>
              )}
            </ListRow>
          ))}
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
