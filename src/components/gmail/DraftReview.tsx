import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Ban } from "lucide-react";
import { db } from "../../db/schema";
import type { GmailAccount, SyncedEmail } from "../../types";
import {
  avatarColor,
  avatarInitial,
  ensureFreshAccessToken,
  generateDraftForEmail,
  getMessageBody,
  parseSender,
  sendReply,
} from "../../lib/gmail";
import { formatGmailTimestamp } from "../../lib/date";
import { Card } from "../ui/Card";
import { Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";

interface Props {
  email: SyncedEmail;
  account: GmailAccount;
  onSent?: () => void;
}

export function DraftReview({ email, account, onSent }: Props) {
  const showToast = useToast();

  // Wrapped in an object so `undefined` unambiguously means "still loading" —
  // .first() itself resolves to `undefined` when no draft exists yet, which
  // would otherwise be indistinguishable from the query not having run.
  const draftResult = useLiveQuery(
    async () => ({ draft: email.id ? await db.draftReplies.where("emailId").equals(email.id).first() : undefined }),
    [email.id],
  );
  const draft = draftResult?.draft;
  const sender = parseSender(email.from);

  const blockedEntry = useLiveQuery(
    () => (account.id ? db.blockedSenders.where("[accountId+email]").equals([account.id, sender.email.toLowerCase()]).first() : undefined),
    [account.id, sender.email],
  );

  const [bodyText, setBodyText] = useState("");
  const initializedRef = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [originalBody, setOriginalBody] = useState<string | null>(null);
  const [loadingOriginal, setLoadingOriginal] = useState(true);

  useEffect(() => {
    if (draft && !initializedRef.current) {
      initializedRef.current = true;
      setBodyText(draft.body);
    }
  }, [draft]);

  // Fetch the original message body for reading context (separate from AI draft generation,
  // which is only triggered by the button below so opening an email never spends API credit).
  useEffect(() => {
    let cancelled = false;
    setLoadingOriginal(true);
    (async () => {
      try {
        const fresh = await ensureFreshAccessToken(account);
        const text = await getMessageBody(fresh.accessToken, email.gmailMessageId);
        if (!cancelled) setOriginalBody(text || email.snippet);
      } catch {
        if (!cancelled) setOriginalBody(email.snippet);
      } finally {
        if (!cancelled) setLoadingOriginal(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, email.gmailMessageId, email.snippet]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateDraftForEmail(account, email);
      initializedRef.current = false; // let the freshly generated body overwrite the textarea
    } catch {
      showToast("AI下書きの作成に失敗しました", "error");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!email.id) return;
    setSaving(true);
    try {
      const now = Date.now();
      if (draft?.id) {
        await db.draftReplies.update(draft.id, { body: bodyText, updatedAt: now });
      } else {
        await db.draftReplies.add({ emailId: email.id, accountId: account.id!, body: bodyText, createdAt: now, updatedAt: now });
      }
      if (email.status !== "sent") {
        await db.syncedEmails.update(email.id, { status: "edited" });
      }
      showToast("下書きを保存しました");
    } catch {
      showToast("保存に失敗しました", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    if (!email.id) return;
    setSending(true);
    try {
      const fresh = await ensureFreshAccessToken(account);
      await sendReply(fresh.accessToken, {
        to: email.from,
        subject: email.subject,
        body: bodyText,
        threadId: email.threadId,
      });
      const now = Date.now();
      if (draft?.id) {
        await db.draftReplies.update(draft.id, { body: bodyText, updatedAt: now, sentAt: now });
      }
      await db.syncedEmails.update(email.id, { status: "sent" });
      showToast("返信を送信しました");
      onSent?.();
    } catch {
      showToast("送信に失敗しました", "error");
    } finally {
      setSending(false);
    }
  }

  async function handleToggleBlock() {
    if (!account.id) return;
    const normalizedEmail = sender.email.toLowerCase();
    if (blockedEntry?.id) {
      await db.blockedSenders.delete(blockedEntry.id);
      showToast("ブロックを解除しました");
    } else {
      if (!confirm(`${sender.email} からのメールを今後この一覧に表示しないようにしますか？(Gmail自体には影響しません)`)) return;
      await db.blockedSenders.add({ accountId: account.id, email: normalizedEmail, createdAt: Date.now() });
      showToast("送信者をブロックしました");
    }
  }

  const alreadySent = email.status === "sent";
  const hasDraft = !!draft;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(sender.email)}`}
        >
          {avatarInitial(sender.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold text-slate-900">{sender.name}</p>
            <span className="shrink-0 text-xs text-slate-400">{formatGmailTimestamp(email.receivedAt)}</span>
          </div>
          {sender.email !== sender.name && <p className="truncate text-xs text-slate-400">{sender.email}</p>}
        </div>
        <button
          type="button"
          onClick={handleToggleBlock}
          aria-label={blockedEntry ? "ブロックを解除" : "送信者をブロック"}
          title={blockedEntry ? "ブロックを解除" : "この送信者をブロック"}
          className={`shrink-0 rounded-full p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50 ${
            blockedEntry ? "text-danger active:bg-red-50" : "text-slate-300 active:bg-red-50 active:text-danger"
          }`}
        >
          <Ban size={16} />
        </button>
      </div>

      <h2 className="text-lg font-semibold leading-snug text-slate-900">{email.subject}</h2>

      <div className="space-y-3 border-b border-slate-100 pb-4">
        {!hasDraft && !generating ? (
          <Button type="button" className="w-full" onClick={handleGenerate}>
            AI下書きを作成
          </Button>
        ) : (
          <>
            <Textarea
              label={alreadySent ? "送信済みの返信内容" : "返信本文"}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={10}
              placeholder={generating ? "AIが下書きを作成しています…" : ""}
              disabled={generating}
            />

            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={handleGenerate}
                disabled={generating || sending}
              >
                {generating ? "生成中..." : "下書きを再生成"}
              </Button>
              <Button type="button" variant="secondary" className="flex-1" onClick={handleSave} disabled={saving || generating}>
                {saving ? "保存中..." : "保存"}
              </Button>
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={handleSend}
              disabled={sending || generating || !bodyText.trim() || alreadySent}
            >
              {alreadySent ? "送信済み" : sending ? "送信中..." : "送信する"}
            </Button>
          </>
        )}
      </div>

      <Card className="whitespace-pre-wrap break-words text-sm text-slate-700">
        {loadingOriginal ? "本文を読み込み中..." : originalBody}
      </Card>
    </div>
  );
}
