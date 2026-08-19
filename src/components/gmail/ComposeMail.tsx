import { useEffect, useRef, useState } from "react";
import type { GmailAccount } from "../../types";
import { ensureFreshAccessToken, fileToAttachment, sendNewMail } from "../../lib/gmail";
import { Input, Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";
import { AttachmentPicker } from "./AttachmentPicker";

/** Mirrors DraftReview.tsx's send-with-undo delay, for the same reason: no Gmail API to
 * recall a message already delivered, so this is the only part of "undo send" that's
 * actually implementable. */
const UNDO_SEND_SECONDS = 6;

interface Props {
  account: GmailAccount;
  onSent?: () => void;
}

/** New-mail compose form (as opposed to DraftReview.tsx, which replies within an existing
 * synced email's thread). Opened from GmailPage's compose FAB. */
export function ComposeMail({ account, onSent }: Props) {
  const showToast = useToast();
  const [toText, setToText] = useState("");
  const [subjectText, setSubjectText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState<number | null>(null);
  const undoTimeoutRef = useRef<number | undefined>(undefined);
  const undoIntervalRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      window.clearTimeout(undoTimeoutRef.current);
      window.clearInterval(undoIntervalRef.current);
    };
  }, []);

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
      setAttachments([]);
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
  const canSend = !sending && !undoActive && toText.trim() !== "" && subjectText.trim() !== "" && bodyText.trim() !== "";

  return (
    <div className="space-y-4">
      <Input
        label="宛先"
        type="email"
        value={toText}
        onChange={(e) => setToText(e.target.value)}
        placeholder="example@example.com"
        disabled={sending || undoActive}
        autoFocus
      />
      <Input
        label="件名"
        value={subjectText}
        onChange={(e) => setSubjectText(e.target.value)}
        disabled={sending || undoActive}
      />
      <Textarea
        label="本文"
        value={bodyText}
        onChange={(e) => setBodyText(e.target.value)}
        rows={10}
        disabled={sending || undoActive}
      />
      <p className="text-right text-xs text-slate-400">{bodyText.length}文字</p>
      <AttachmentPicker files={attachments} onChange={setAttachments} disabled={sending || undoActive} />
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
