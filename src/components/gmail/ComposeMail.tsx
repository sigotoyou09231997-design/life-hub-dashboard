import { useEffect, useRef, useState } from "react";
import type { GmailAccount } from "../../types";
import { ApiFunctionError, ensureFreshAccessToken, fileToAttachment, generateComposeDraft, sendNewMail } from "../../lib/gmail";
import { Card } from "../ui/Card";
import { Input, Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";
import { AttachmentPicker } from "./AttachmentPicker";

/** Mirrors DraftReview.tsx's send-with-undo delay, for the same reason: no Gmail API to
 * recall a message already delivered, so this is the only part of "undo send" that's
 * actually implementable. */
const UNDO_SEND_SECONDS = 6;

/** Same reasoning as DraftReview.tsx's describeGenerateError() — prefer the server's own
 * specific error message, fall back to a generic one by HTTP status. */
function describeGenerateError(err: unknown): string {
  if (err instanceof ApiFunctionError) {
    if (err.serverMessage) return err.serverMessage;
    if (err.status === 429) return "AIの利用が集中しています。少し時間を置いてから再度お試しください";
    if (err.status === 502 || err.status === 503 || err.status === 504) return "生成に時間がかかりすぎて失敗しました。もう一度お試しください";
    if (err.status === 401 || err.status === 403) return "AI機能の認証エラーです。解決しない場合は管理者に連絡してください";
  }
  return "AI下書きの作成に失敗しました";
}

interface Props {
  account: GmailAccount;
  onSent?: () => void;
}

/** New-mail compose form (as opposed to DraftReview.tsx, which replies within an existing
 * synced email's thread). Opened from GmailPage's compose FAB. Supports the same AI-drafting
 * flow as replies (generateComposeDraft), just without a received email to respond to —
 * 「AIに伝えたいこと」carries the entire content of what to write. */
export function ComposeMail({ account, onSent }: Props) {
  const showToast = useToast();
  const [toText, setToText] = useState("");
  const [subjectText, setSubjectText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState<number | null>(null);
  const undoTimeoutRef = useRef<number | undefined>(undefined);
  const undoIntervalRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      window.clearTimeout(undoTimeoutRef.current);
      window.clearInterval(undoIntervalRef.current);
    };
  }, []);

  async function handleGenerate() {
    if (!toText.trim()) {
      showToast("宛先を入力してください", "error");
      return;
    }
    if (!userNotes.trim()) {
      showToast("メールに書きたい内容を入力してください", "error");
      return;
    }
    setGenerating(true);
    try {
      const result = await generateComposeDraft(account, {
        to: toText.trim(),
        userNotes: userNotes.trim(),
        currentDraftBody: hasDraft ? bodyText : undefined,
      });
      setBodyText(result.draft);
      setSubjectText(result.subject || subjectText);
      setKeyPoints(result.keyPoints);
      setHasDraft(true);
    } catch (err) {
      showToast(describeGenerateError(err), "error");
    } finally {
      setGenerating(false);
    }
  }

  async function performSend() {
    setSending(true);
    try {
      const fresh = await ensureFreshAccessToken(account);
      const encodedAttachments = await Promise.all(attachments.map(fileToAttachment));
      await sendNewMail(fresh.accessToken, { to: toText, subject: subjectText, body: bodyText, attachments: encodedAttachments });
      showToast("メールを送信しました");
      setToText("");
      setSubjectText("");
      setBodyText("");
      setUserNotes("");
      setKeyPoints([]);
      setAttachments([]);
      setHasDraft(false);
      onSent?.();
    } catch {
      showToast("送信に失敗しました", "error");
    } finally {
      setSending(false);
    }
  }

  function handleStartSend() {
    setUndoSecondsLeft(UNDO_SEND_SECONDS);
    undoIntervalRef.current = window.setInterval(() => {
      setUndoSecondsLeft((s) => (s !== null ? s - 1 : s));
    }, 1000);
    undoTimeoutRef.current = window.setTimeout(() => {
      window.clearInterval(undoIntervalRef.current);
      setUndoSecondsLeft(null);
      void performSend();
    }, UNDO_SEND_SECONDS * 1000);
  }

  function handleCancelSend() {
    window.clearTimeout(undoTimeoutRef.current);
    window.clearInterval(undoIntervalRef.current);
    setUndoSecondsLeft(null);
    showToast("送信を取り消しました");
  }

  const undoActive = undoSecondsLeft !== null;
  const busy = sending || generating || undoActive;
  const canSend = !busy && toText.trim() !== "" && subjectText.trim() !== "" && bodyText.trim() !== "";

  return (
    <div className="space-y-4">
      <Input
        label="宛先"
        type="email"
        value={toText}
        onChange={(e) => setToText(e.target.value)}
        placeholder="example@example.com"
        disabled={busy}
        autoFocus
      />
      <Textarea
        label="AIに伝えたいこと（任意）"
        value={userNotes}
        onChange={(e) => setUserNotes(e.target.value)}
        rows={3}
        placeholder="例：来週の打ち合わせのお願い、資料の送付連絡　など"
        disabled={busy}
      />
      <Button type="button" variant="secondary" className="w-full" onClick={handleGenerate} disabled={busy}>
        {generating ? "生成中..." : hasDraft ? "再生成" : "AI下書きを作成"}
      </Button>
      <Input label="件名" value={subjectText} onChange={(e) => setSubjectText(e.target.value)} disabled={busy} />
      {keyPoints.length > 0 && (
        <Card className="space-y-1.5 bg-accent-light/40">
          <p className="text-xs font-medium text-accent">メールに含めたいポイント</p>
          <ul className="space-y-1 text-xs text-slate-600">
            {keyPoints.map((point, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="shrink-0 text-accent">・</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Textarea
        label="本文"
        value={bodyText}
        onChange={(e) => setBodyText(e.target.value)}
        rows={10}
        placeholder={generating ? "AIが下書きを作成しています…" : ""}
        disabled={busy}
      />
      <p className="text-right text-xs text-slate-400">{bodyText.length}文字</p>
      <AttachmentPicker files={attachments} onChange={setAttachments} disabled={busy} />
      {undoActive ? (
        <Button type="button" variant="secondary" className="w-full" onClick={handleCancelSend}>
          送信を取り消す（{undoSecondsLeft}）
        </Button>
      ) : (
        <Button type="button" className="w-full" onClick={handleStartSend} disabled={!canSend}>
          {sending ? "送信中..." : "送信する"}
        </Button>
      )}
    </div>
  );
}
