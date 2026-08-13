import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Ban } from "lucide-react";
import { db } from "../../db/schema";
import type { GmailAccount, SyncedEmail } from "../../types";
import {
  avatarColor,
  avatarInitial,
  ensureFreshAccessToken,
  formatCandidateLabel,
  generateDraftForEmail,
  getMessageBody,
  parseSender,
  sendReply,
  type CandidateDate,
} from "../../lib/gmail";
import { formatGmailTimestamp, parseDate } from "../../lib/date";
import { Card } from "../ui/Card";
import { Input, Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/ToastProvider";
import { MonthView } from "../calendar/MonthView";
import { blockSenderRemote, unblockSenderRemote } from "../../lib/blockedSenders";

const EMPTY_DATE_SET = new Set<string>();

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
  const [subjectText, setSubjectText] = useState("");
  const [toText, setToText] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const initializedRef = useRef(false);
  const toInitializedRef = useRef(false);
  const userNotesInitializedRef = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [originalBody, setOriginalBody] = useState<string | null>(null);
  const [loadingOriginal, setLoadingOriginal] = useState(true);
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [candidateDates, setCandidateDates] = useState<CandidateDate[]>([]);
  const [earliestDate, setEarliestDate] = useState("");
  const [editingCandidateIndex, setEditingCandidateIndex] = useState<number | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [pickerMonth, setPickerMonth] = useState(new Date());

  // Shown as dots on the date picker so the user can see at a glance which days
  // already have something booked while choosing a candidate date.
  const calendarEvents = useLiveQuery(() => db.calendarEvents.toArray(), []);
  const busyDateSet = new Set((calendarEvents ?? []).map((e) => e.date));

  useEffect(() => {
    if (draft && !initializedRef.current) {
      initializedRef.current = true;
      setBodyText(draft.body);
      setSubjectText(draft.subject || `Re: ${email.subject}`);
    }
  }, [draft, email.subject]);

  // Separate from the body/subject init above: "to" isn't AI-generated and must
  // NOT reset when handleGenerate() re-runs the effect above (initializedRef.current
  // = false) to pull a freshly-regenerated body/subject into the textarea/input.
  useEffect(() => {
    if (draftResult && !toInitializedRef.current) {
      toInitializedRef.current = true;
      setToText(draft?.to || sender.email);
    }
  }, [draftResult, draft, sender.email]);

  // Same reasoning as "to" above: the user's own instructions to the AI aren't
  // something handleGenerate() should ever overwrite, so this has its own guard
  // separate from the body/subject one.
  useEffect(() => {
    if (draftResult && !userNotesInitializedRef.current) {
      userNotesInitializedRef.current = true;
      setUserNotes(draft?.userNotes ?? "");
    }
  }, [draftResult, draft]);

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
      const result = await generateDraftForEmail(account, email, userNotes.trim() || undefined);
      setKeyPoints(result.keyPoints);
      setCandidateDates(result.candidateDates);
      setEarliestDate(result.earliestDate);
      initializedRef.current = false; // let the freshly generated body overwrite the textarea
    } catch {
      showToast("AI下書きの作成に失敗しました", "error");
    } finally {
      setGenerating(false);
    }
  }

  function openEditCandidate(index: number) {
    const c = candidateDates[index];
    setEditDate(c.date);
    setEditStartTime(c.startTime ?? "");
    setEditEndTime(c.endTime ?? "");
    setPickerMonth(parseDate(c.date));
    setEditingCandidateIndex(index);
  }

  function handleApplyCandidateDate() {
    if (editingCandidateIndex === null || !editDate) return;
    const old = candidateDates[editingCandidateIndex];
    const newSlot = { date: editDate, startTime: editStartTime || undefined, endTime: editEndTime || undefined };
    const newLabel = formatCandidateLabel(newSlot);
    if (!bodyText.includes(old.label)) {
      showToast("本文中に該当の候補日が見つかりませんでした。本文を直接編集してください", "error");
      setEditingCandidateIndex(null);
      return;
    }
    setBodyText((prev) => prev.replace(old.label, newLabel));
    setCandidateDates((prev) => prev.map((c, i) => (i === editingCandidateIndex ? { ...newSlot, label: newLabel } : c)));
    setEditingCandidateIndex(null);
  }

  async function handleSave() {
    if (!email.id) return;
    setSaving(true);
    try {
      const now = Date.now();
      if (draft?.id) {
        await db.draftReplies.update(draft.id, { body: bodyText, subject: subjectText, to: toText, userNotes, updatedAt: now });
      } else {
        await db.draftReplies.add({
          emailId: email.id,
          accountId: account.id!,
          body: bodyText,
          subject: subjectText,
          to: toText,
          userNotes,
          createdAt: now,
          updatedAt: now,
        });
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
        to: toText,
        subject: subjectText,
        body: bodyText,
        threadId: email.threadId,
      });
      const now = Date.now();
      if (draft?.id) {
        await db.draftReplies.update(draft.id, { body: bodyText, subject: subjectText, to: toText, updatedAt: now, sentAt: now });
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
      void unblockSenderRemote(account.email, normalizedEmail);
      showToast("ブロックを解除しました");
    } else {
      if (!confirm(`${sender.email} からのメールを今後この一覧に表示しないようにしますか？(Gmail自体には影響しません)`)) return;
      await db.blockedSenders.add({ accountId: account.id, email: normalizedEmail, createdAt: Date.now() });
      void blockSenderRemote(account.email, normalizedEmail);
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
        {!alreadySent && (
          <Textarea
            label="AIに伝えたいこと（任意）"
            value={userNotes}
            onChange={(e) => setUserNotes(e.target.value)}
            rows={3}
            placeholder="例：来週火曜以外なら対応可能、金額について触れたい、丁重にお断りしたい　など"
            disabled={generating}
          />
        )}
        {!hasDraft && !generating ? (
          <Button type="button" className="w-full" onClick={handleGenerate}>
            AI下書きを作成
          </Button>
        ) : (
          <>
            <Input
              label="宛先"
              type="email"
              value={toText}
              onChange={(e) => setToText(e.target.value)}
              disabled={generating || alreadySent}
            />
            <Input
              label="件名"
              value={subjectText}
              onChange={(e) => setSubjectText(e.target.value)}
              placeholder={generating ? "AIが件名を考えています…" : ""}
              disabled={generating || alreadySent}
            />
            {keyPoints.length > 0 && (
              <Card className="space-y-1.5 bg-accent-light/40">
                <p className="text-xs font-medium text-accent">返信に含めたいポイント</p>
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
            {candidateDates.length > 0 && !alreadySent && (
              <div className="flex flex-wrap gap-2">
                {candidateDates.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => openEditCandidate(i)}
                    className="rounded-full border border-accent/30 bg-accent-light px-3 py-1.5 text-xs font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    {c.label} を変更
                  </button>
                ))}
              </div>
            )}
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
              disabled={sending || generating || !bodyText.trim() || !toText.trim() || !subjectText.trim() || alreadySent}
            >
              {alreadySent ? "送信済み" : sending ? "送信中..." : "送信する"}
            </Button>
          </>
        )}
      </div>

      <Card className="whitespace-pre-wrap break-words text-sm text-slate-700">
        {loadingOriginal ? "本文を読み込み中..." : originalBody}
      </Card>

      <Sheet open={editingCandidateIndex !== null} onClose={() => setEditingCandidateIndex(null)} title="候補日を変更">
        <div className="space-y-4">
          <MonthView
            currentMonth={pickerMonth}
            onMonthChange={setPickerMonth}
            selectedDate={editDate}
            onSelectDate={setEditDate}
            eventDates={busyDateSet}
            taskDates={EMPTY_DATE_SET}
            minDate={earliestDate || undefined}
          />
          {earliestDate && (
            <p className="text-xs text-slate-400">
              メール本文の記載により、{earliestDate}以降のみ選択できます。
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input label="開始時刻(任意)" type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} />
            <Input label="終了時刻(任意)" type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} />
          </div>
          <Button type="button" className="w-full" onClick={handleApplyCandidateDate} disabled={!editDate}>
            本文に反映する
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
