import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { GmailAccount, SyncedEmail } from "../../types";
import { ensureFreshAccessToken, generateDraftForEmail, sendReply } from "../../lib/gmail";
import { Card } from "../ui/Card";
import { Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";

interface Props {
  email: SyncedEmail;
  account: GmailAccount;
  onSent: () => void;
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

  const [bodyText, setBodyText] = useState("");
  const initializedRef = useRef(false);
  const autoStartedRef = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (draft && !initializedRef.current) {
      initializedRef.current = true;
      setBodyText(draft.body);
    }
  }, [draft]);

  // First time this email is opened (no draft yet), kick off generation automatically.
  useEffect(() => {
    if (draftResult && !draftResult.draft && !autoStartedRef.current) {
      autoStartedRef.current = true;
      setGenerating(true);
      generateDraftForEmail(account, email)
        .catch(() => showToast("AI下書きの作成に失敗しました", "error"))
        .finally(() => setGenerating(false));
    }
  }, [draftResult, account, email, showToast]);

  async function handleRegenerate() {
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
      onSent();
    } catch {
      showToast("送信に失敗しました", "error");
    } finally {
      setSending(false);
    }
  }

  const alreadySent = email.status === "sent";

  return (
    <div className="space-y-4">
      <Card className="space-y-1 text-sm">
        <p className="text-slate-400">差出人: {email.from}</p>
        <p className="font-medium text-slate-900">{email.subject}</p>
      </Card>

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
          onClick={handleRegenerate}
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
    </div>
  );
}
