import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Ban, CalendarPlus, Copy, Mail, MailOpen, Star } from "lucide-react";
import { db } from "../../db/schema";
import type { GmailAccount, SyncedEmail } from "../../types";
import {
  ApiFunctionError,
  avatarColor,
  avatarInitial,
  ensureFreshAccessToken,
  fileToAttachment,
  formatCandidateLabel,
  generateDraftForEmail,
  getMessageBody,
  parseSender,
  sendReply,
  threadHasSentReplyAfter,
  type CandidateDate,
} from "../../lib/gmail";
import { formatGmailTimestamp, parseDate } from "../../lib/date";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Input, Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { MailPlanImport } from "./MailPlanImport";
import { useToast } from "../ui/ToastProvider";
import { MonthView } from "../calendar/MonthView";
import { blockSenderRemote, unblockSenderRemote } from "../../lib/blockedSenders";
import { updateMessageState } from "../../lib/gmailMessageState";
import { AttachmentPicker } from "./AttachmentPicker";

const EMPTY_DATE_SET = new Set<string>();

/** How long "送信する" holds off actually calling the Gmail API, showing a cancel
 * button in the meantime — mirrors Gmail's own "送信取り消し" UX. There's no Gmail
 * API to recall an email already delivered, so this delay-then-send is the only
 * part of "undo send" that's actually implementable. */
const UNDO_SEND_SECONDS = 6;

/** Buffer subtracted from the send attempt's start time when verifying against Gmail's
 * thread state after sendReply() throws, to absorb clock skew between this client and
 * Gmail's internalDate. Kept tight (not e.g. the email's receivedAt) so a thread that
 * already has an earlier legitimate sent reply from a previous exchange doesn't produce
 * a false positive for *this* send attempt. */
const SEND_VERIFY_CLOCK_SKEW_MS = 2 * 60 * 1000;

/** Distinguishes the common failure causes behind a generate/regenerate call so the
 * toast says something actionable instead of always the same generic message.
 * Prefers the server's own `{ error: "..." }` message (api/generateDraft.ts already
 * writes specific, user-facing Japanese text for known failure modes) and only falls
 * back to a canned message by HTTP status for opaque platform-level failures (e.g. a
 * raw timeout/error page with no JSON body). */
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
  email: SyncedEmail;
  account: GmailAccount;
  onSent?: () => void;
  /** "pane": always-expanded desktop 3-pane layout (PC reference). "sheet":
   * compact mobile bottom-sheet layout where the original body and AI返信案
   * sections start collapsed so the mail list stays visible behind it. */
  variant?: "pane" | "sheet";
}

export function DraftReview({ email, account, onSent, variant = "pane" }: Props) {
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
  const [attachments, setAttachments] = useState<File[]>([]);
  // Tracks the updatedAt of the draft version currently reflected in bodyText/subjectText,
  // rather than a plain boolean: a boolean set from handleGenerate() after its await can miss
  // a live-query re-render that lands mid-await (still holding the pre-reset value), and since
  // refs don't trigger re-renders, the effect below would then never run again for that
  // generation — leaving the freshly-regenerated draft in the DB but not on screen.
  const appliedDraftVersionRef = useRef<number | undefined>(undefined);
  const toInitializedRef = useRef(false);
  const userNotesInitializedRef = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState<number | null>(null);
  const undoTimeoutRef = useRef<number | undefined>(undefined);
  const undoIntervalRef = useRef<number | undefined>(undefined);
  const [originalBody, setOriginalBody] = useState<string | null>(null);
  const [loadingOriginal, setLoadingOriginal] = useState(true);
  const [bodyIsFallback, setBodyIsFallback] = useState(false);
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [candidateDates, setCandidateDates] = useState<CandidateDate[]>([]);
  const [earliestDate, setEarliestDate] = useState("");
  const [editingCandidateIndex, setEditingCandidateIndex] = useState<number | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [pickerMonth, setPickerMonth] = useState(new Date());

  // variant="sheet"のみで使う折りたたみ状態(初期表示をコンパクトに保つため)。
  const [originalExpanded, setOriginalExpanded] = useState(false);
  const [replyExpanded, setReplyExpanded] = useState(false);
  // このメールから旅行の日程・予定・タスクを作る画面(MailPlanImport)を開いているか。
  const [planImportOpen, setPlanImportOpen] = useState(false);

  // Shown as dots on the date picker so the user can see at a glance which days
  // already have something booked while choosing a candidate date.
  const calendarEvents = useLiveQuery(() => db.calendarEvents.toArray(), []);
  const busyDateSet = new Set((calendarEvents ?? []).map((e) => e.date));

  useEffect(() => {
    setOriginalExpanded(false);
    setReplyExpanded(false);
  }, [email.id]);

  useEffect(() => {
    if (draft && draft.updatedAt !== appliedDraftVersionRef.current) {
      appliedDraftVersionRef.current = draft.updatedAt;
      setBodyText(draft.body);
      setSubjectText(draft.subject || `Re: ${email.subject}`);
    }
  }, [draft, email.subject]);

  // Separate from the body/subject init above: "to" isn't AI-generated and must
  // NOT reset when handleGenerate() causes the effect above to pull a freshly-regenerated
  // body/subject into the textarea/input.
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
    setBodyIsFallback(false);
    (async () => {
      try {
        const fresh = await ensureFreshAccessToken(account);
        const text = await getMessageBody(fresh.accessToken, email.gmailMessageId);
        if (!cancelled) {
          setOriginalBody(text || email.snippet);
          setBodyIsFallback(!text);
        }
      } catch {
        if (!cancelled) {
          setOriginalBody(email.snippet);
          setBodyIsFallback(true);
        }
      } finally {
        if (!cancelled) setLoadingOriginal(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, email.gmailMessageId, email.snippet]);

  // Closing the tab/navigating away mid-countdown kills these timers along with the
  // page, so an in-flight undo window silently never sends — same as it would if the
  // component simply weren't there to fire the setTimeout.
  useEffect(() => {
    return () => {
      window.clearTimeout(undoTimeoutRef.current);
      window.clearInterval(undoIntervalRef.current);
    };
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    try {
      // Only pass the on-screen body when regenerating an existing draft (not on
      // first-time generation, when bodyText is still empty) — see generateDraftForEmail's
      // doc comment for why this needs to be the live state, not the possibly-stale saved draft.
      const result = await generateDraftForEmail(account, email, userNotes.trim() || undefined, draft ? bodyText : undefined);
      setKeyPoints(result.keyPoints);
      setCandidateDates(result.candidateDates);
      setEarliestDate(result.earliestDate);
    } catch (err) {
      showToast(describeGenerateError(err), "error");
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

  async function performSend() {
    if (!email.id) return;
    setSending(true);
    const attemptStartedAt = Date.now();
    const markSent = async () => {
      const now = Date.now();
      if (draft?.id) {
        await db.draftReplies.update(draft.id, { body: bodyText, subject: subjectText, to: toText, updatedAt: now, sentAt: now });
      }
      // 送信済みは他端末にも配る(既読と同じ仕組み) — 同じメールへの二重返信を防ぐ。
      await updateMessageState(account.email, email, { status: "sent" });
    };
    try {
      const fresh = await ensureFreshAccessToken(account);
      const encodedAttachments = await Promise.all(attachments.map(fileToAttachment));
      await sendReply(fresh.accessToken, {
        to: toText,
        subject: subjectText,
        body: bodyText,
        threadId: email.threadId,
        attachments: encodedAttachments,
      });
      await markSent();
      showToast("返信を送信しました");
      onSent?.();
    } catch {
      // sendReply() throwing doesn't guarantee Gmail never received it — the request can
      // succeed server-side while the response is lost to a network drop. Check Gmail's
      // own thread state before telling the user it failed, so a reply that actually went
      // out never gets stuck showing as unsent in 送信済み (see threadHasSentReplyAfter).
      try {
        const verifyFresh = await ensureFreshAccessToken(account);
        const actuallySent = await threadHasSentReplyAfter(verifyFresh.accessToken, email.threadId, attemptStartedAt - SEND_VERIFY_CLOCK_SKEW_MS);
        if (actuallySent) {
          await markSent();
          showToast("返信を送信しました");
          onSent?.();
          return;
        }
      } catch {
        // Verification itself failed (e.g. offline) — fall through to the failure toast.
      }
      showToast("送信に失敗しました", "error");
    } finally {
      setSending(false);
    }
  }

  // "送信する" doesn't call the Gmail API right away — it starts a cancelable countdown
  // first (see UNDO_SEND_SECONDS) so a slip-of-the-thumb tap can still be undone, the
  // same way Gmail's own "送信取り消し" works.
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

  async function handleToggleBlock() {
    if (!account.id) return;
    const normalizedEmail = sender.email.toLowerCase();
    if (blockedEntry?.id) {
      await db.blockedSenders.delete(blockedEntry.id);
      void unblockSenderRemote(account.email, normalizedEmail);
      showToast("ブロックを解除しました");
    } else {
      if (!confirm(`${sender.email} からのメールを今後この一覧に表示しないようにしますか？(Gmail自体には影響しません)`)) return;
      const localId = await db.blockedSenders.add({ accountId: account.id, email: normalizedEmail, createdAt: Date.now() });
      void blockSenderRemote(account.email, normalizedEmail, localId);
      showToast("送信者をブロックしました");
    }
  }

  // 既読は「開いたら自動」ではなく、必ずこのボタン(と一覧のチェックボタン)を押した時だけ
  // 付ける。押し間違えても未読に戻せるようにトグルにしてある。
  async function handleToggleRead() {
    if (!email.id) return;
    if (email.readAt) {
      await updateMessageState(account.email, email, { readAt: undefined });
      showToast("未読に戻しました");
    } else {
      await updateMessageState(account.email, email, { readAt: Date.now() });
      showToast("既読にしました");
    }
  }

  /** 「重要」の付け外し。既読と同じ仕組み(gmail_message_state)に乗せているので、
   * 他の端末の一覧にも同じ印が付く。 */
  async function handleToggleImportant() {
    if (!email.id) return;
    if (email.importantAt) {
      await updateMessageState(account.email, email, { importantAt: undefined });
      showToast("重要を外しました");
    } else {
      await updateMessageState(account.email, email, { importantAt: Date.now() });
      showToast("重要にしました");
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(bodyText);
      showToast("返信内容をコピーしました");
    } catch {
      showToast("コピーに失敗しました", "error");
    }
  }

  const alreadySent = email.status === "sent";
  const hasDraft = !!draft;
  const undoActive = undoSecondsLeft !== null;

  const senderRow = (
    <div className="flex items-start gap-3">
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(sender.email)}`}
      >
        {avatarInitial(sender.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{sender.name}</p>
        {sender.email !== sender.name && <p className="truncate text-xs text-slate-500">{sender.email}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-slate-500">{formatGmailTimestamp(email.receivedAt)}</span>
        <button
          type="button"
          onClick={handleToggleImportant}
          aria-label={email.importantAt ? "重要を外す" : "重要にする"}
          title={email.importantAt ? "重要を外す" : "重要にする(一覧の「重要」タブへ移ります)"}
          className={`rounded-full p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/50 ${
            email.importantAt ? "text-warning active:bg-amber-50" : "text-slate-300 active:bg-amber-50 active:text-warning"
          }`}
        >
          <Star size={16} fill={email.importantAt ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          onClick={handleToggleRead}
          aria-label={email.readAt ? "未読に戻す" : "既読にする"}
          title={email.readAt ? "未読に戻す" : "既読にする(一覧の「既読」タブへ移ります)"}
          className={`rounded-full p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
            email.readAt ? "text-accent active:bg-accent-light" : "text-slate-300 active:bg-accent-light active:text-accent"
          }`}
        >
          {email.readAt ? <MailOpen size={16} /> : <Mail size={16} />}
        </button>
        {/* 既読/ブロックはこのメール自体の状態を切り替えるもの、こちらは別の場所に予定を
            作るもの。同じ見た目のアイコンで並べると押し分けにくいので、塗りのボタンにして
            はっきり別物に見せる。 */}
        <button
          type="button"
          onClick={() => setPlanImportOpen(true)}
          aria-label="このメールから予定を作る"
          title="このメールの内容から、旅行の日程・予定・タスクを作る"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all duration-200 ease-out active:translate-y-px active:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none motion-reduce:active:translate-y-0"
        >
          <CalendarPlus size={14} />
          <span className="hidden sm:inline">予定にする</span>
        </button>
        <button
          type="button"
          onClick={handleToggleBlock}
          aria-label={blockedEntry ? "ブロックを解除" : "送信者をブロック"}
          title={blockedEntry ? "ブロックを解除" : "この送信者をブロック"}
          className={`rounded-full p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50 ${
            blockedEntry ? "text-danger active:bg-red-50" : "text-slate-300 active:bg-red-50 active:text-danger"
          }`}
        >
          <Ban size={16} />
        </button>
      </div>
    </div>
  );

  const originalBodyText = loadingOriginal ? "本文を読み込み中..." : originalBody;

  const originalBodyNote = bodyIsFallback && !loadingOriginal && (
    <p className="mb-2 text-xs text-slate-400">本文は保存済みの抜粋を表示しています</p>
  );

  const replyFormFields = (
    <>
      <Input
        label="宛先"
        type="email"
        value={toText}
        onChange={(e) => setToText(e.target.value)}
        disabled={generating || alreadySent || undoActive}
      />
      <Input
        label="件名"
        value={subjectText}
        onChange={(e) => setSubjectText(e.target.value)}
        placeholder={generating ? "AIが件名を考えています…" : ""}
        disabled={generating || alreadySent || undoActive}
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
        rows={variant === "sheet" ? 6 : 10}
        placeholder={generating ? "AIが下書きを作成しています…" : ""}
        disabled={generating || undoActive}
      />
      <p className="text-right text-xs text-slate-400">{bodyText.length}文字</p>
      <AttachmentPicker files={attachments} onChange={setAttachments} disabled={generating || sending || undoActive} />
      <div className="flex gap-3">
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          onClick={handleGenerate}
          disabled={generating || sending || undoActive}
        >
          {generating ? "生成中..." : "再生成"}
        </Button>
        <Button type="button" variant="secondary" className="flex-1" onClick={handleSave} disabled={saving || generating || undoActive}>
          {saving ? "保存中..." : "保存"}
        </Button>
        {!alreadySent && (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="shrink-0"
            onClick={handleCopy}
            disabled={generating}
            aria-label="コピー"
            title="コピー"
          >
            <Copy size={18} />
          </Button>
        )}
      </div>
      {undoActive ? (
        <Button type="button" variant="secondary" className="w-full" onClick={handleCancelSend}>
          送信を取り消す（{undoSecondsLeft}）
        </Button>
      ) : (
        <Button
          type="button"
          className="w-full"
          onClick={handleStartSend}
          disabled={sending || generating || !bodyText.trim() || !toText.trim() || !subjectText.trim() || alreadySent}
        >
          {alreadySent ? "送信済み" : sending ? "送信中..." : "送信する"}
        </Button>
      )}
    </>
  );

  // alreadySentの時だけ使う読み取り専用表示(送信済みは再編集・再生成させない)。
  const replyPreviewBlock = (
    <>
      <div className="glass-row whitespace-pre-wrap break-words rounded-xl px-4 py-3.5 text-sm text-slate-700">
        {bodyText}
      </div>
      <p className="mt-1.5 text-right text-xs text-slate-400">{bodyText.length}文字</p>
    </>
  );

  const planImportSheet = (
    <MailPlanImport email={email} account={account} open={planImportOpen} onClose={() => setPlanImportOpen(false)} />
  );

  const candidateSheet = (
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
        {earliestDate && <p className="text-xs text-slate-400">メール本文の記載により、{earliestDate}以降のみ選択できます。</p>}
        <div className="grid grid-cols-2 gap-3">
          <Input label="開始時刻(任意)" type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} />
          <Input label="終了時刻(任意)" type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} />
        </div>
        <Button type="button" className="w-full" onClick={handleApplyCandidateDate} disabled={!editDate}>
          本文に反映する
        </Button>
      </div>
    </Sheet>
  );

  if (variant === "sheet") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold leading-snug text-slate-900">{email.subject}</h2>
          {hasDraft && <Badge tone="accent">AI下書き</Badge>}
        </div>

        {senderRow}

        {/* 元メール本文: 初期は折りたたみ、タップで全文表示 */}
        <div>
          <button
            type="button"
            onClick={() => setOriginalExpanded((v) => !v)}
            className="mb-1.5 text-xs font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {originalExpanded ? "元のメールを閉じる" : "元のメールを表示"}
          </button>
          {originalExpanded ? (
            <div className="glass-row whitespace-pre-wrap break-words rounded-xl px-4 py-3.5 text-sm text-slate-700">
              {bodyIsFallback && !loadingOriginal && <p className="mb-2 text-xs text-slate-400">本文は保存済みの抜粋を表示しています</p>}
              {loadingOriginal ? "本文を読み込み中..." : originalBody}
            </div>
          ) : (
            <p className="glass-row line-clamp-2 rounded-xl px-4 py-3 text-sm text-slate-600">{email.snippet}</p>
          )}
        </div>

        <div className="border-t border-white/40 pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700">AI返信案</p>
            {hasDraft && <Badge tone="success">準備完了</Badge>}
          </div>

          {!hasDraft && !generating ? (
            <div className="mt-3 space-y-3">
              {!alreadySent && (
                <Textarea
                  label="AIに伝えたいこと（任意）"
                  value={userNotes}
                  onChange={(e) => setUserNotes(e.target.value)}
                  rows={3}
                  placeholder="例：来週火曜以外なら対応可能、金額について触れたい、丁重にお断りしたい　など"
                />
              )}
              <Button type="button" className="w-full" onClick={handleGenerate}>
                AI下書きを作成
              </Button>
            </div>
          ) : !replyExpanded ? (
            <button
              type="button"
              onClick={() => setReplyExpanded(true)}
              className="mt-2 text-xs font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              返信本文を表示
            </button>
          ) : (
            <div className="mt-3 space-y-3">
              {!alreadySent && (
                <Textarea
                  label="AIに伝えたいこと（任意）"
                  value={userNotes}
                  onChange={(e) => setUserNotes(e.target.value)}
                  rows={2}
                  placeholder="例：来週火曜以外なら対応可能、金額について触れたい、丁重にお断りしたい　など"
                  disabled={generating}
                />
              )}
              {alreadySent ? replyPreviewBlock : replyFormFields}
            </div>
          )}
        </div>

        {candidateSheet}
      {planImportSheet}
      </div>
    );
  }

  return (
    // ページ全体が自然にスクロールする通常のページとして表示する(固定高さ+内部
    // overflow-y-autoにはしない) — 長い本文/AI返信文が小さな内部スクロール領域に
    // 閉じ込められ、全文を見るのにスクロールが必要になっていたのを解消するため。
    <div className="grid grid-cols-1 gap-6 lg:items-start lg:gap-5 lg:grid-cols-[minmax(320px,0.95fr)_minmax(360px,1.15fr)]">
      {/* 返信: AI下書きの作成・プレビュー・編集・送信。モバイルでは元メール本文より
          先(上)に表示する — スクロールなしですぐ返信内容が見えるように。
          両カラムとも面(Card)で包む。以前はページのpx-5に直接乗せていたが、背景が
          写真になった今、面の無い列は濃いインクが夜空に沈んで読めなくなる。横方向の
          paddingが重なるのを避けるため、本文は面の中でさらに.glass-rowにはせず、
          カードの地の上に直接置く(インセットは面の中のくぼみなので、面が一枚あれば
          もう一段沈める必要はない)。 */}
      <Card className="flex flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-700">AI返信案</p>
          {hasDraft && <Badge tone="success">準備完了</Badge>}
        </div>

        {!hasDraft && !generating ? (
          <div className="mt-3 flex flex-col gap-3">
            {!alreadySent && (
              <Textarea
                label="AIに伝えたいこと（任意）"
                value={userNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                rows={4}
                placeholder="例：来週火曜以外なら対応可能、金額について触れたい、丁重にお断りしたい　など"
              />
            )}
            <Button type="button" className="w-full" onClick={handleGenerate}>
              AI下書きを作成
            </Button>
          </div>
        ) : alreadySent ? (
          <div className="mt-3 flex flex-col">{replyPreviewBlock}</div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <Textarea
              label="AIに伝えたいこと（任意）"
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              rows={3}
              placeholder="例：来週火曜以外なら対応可能、金額について触れたい、丁重にお断りしたい　など"
              disabled={generating}
            />
            {replyFormFields}
          </div>
        )}
      </Card>

      {/* 読む: 件名→送信者→区切り線→元メール本文 */}
      <Card className="flex flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold leading-snug text-slate-900">{email.subject}</h2>
          {hasDraft && <Badge tone="accent">AI下書き</Badge>}
        </div>
        <div className="mt-3 shrink-0">{senderRow}</div>
        <div className="my-4 shrink-0 border-t border-white/40" />
        {originalBodyNote}
        <div className="whitespace-pre-wrap break-words text-sm text-slate-700">{originalBodyText}</div>
      </Card>

      {candidateSheet}
      {planImportSheet}
    </div>
  );
}
