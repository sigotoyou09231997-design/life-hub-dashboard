import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Ban, Copy } from "lucide-react";
import { db } from "../../db/schema";
import type { GmailAccount, SyncedEmail } from "../../types";
import {
  ApiFunctionError,
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
import { Badge } from "../ui/Badge";
import { Input, Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/ToastProvider";
import { MonthView } from "../calendar/MonthView";
import { blockSenderRemote, unblockSenderRemote } from "../../lib/blockedSenders";

const EMPTY_DATE_SET = new Set<string>();

/** How long "送信する" holds off actually calling the Gmail API, showing a cancel
 * button in the meantime — mirrors Gmail's own "送信取り消し" UX. There's no Gmail
 * API to recall an email already delivered, so this delay-then-send is the only
 * part of "undo send" that's actually implementable. */
const UNDO_SEND_SECONDS = 6;

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
      await db.blockedSenders.add({ accountId: account.id, email: normalizedEmail, createdAt: Date.now() });
      void blockSenderRemote(account.email, normalizedEmail);
      showToast("送信者をブロックしました");
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

  const originalBodyBlock = (
    <>
      {bodyIsFallback && !loadingOriginal && (
        <p className="mb-2 text-xs text-slate-400">本文は保存済みの抜粋を表示しています</p>
      )}
      <div className="glass-row whitespace-pre-wrap break-words rounded-xl px-4 py-3.5 text-sm text-slate-700">
        {loadingOriginal ? "本文を読み込み中..." : originalBody}
      </div>
    </>
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
          一覧画面(GmailInbox)と同じく、外側をglass-cardで包まない — ページ自身の
          px-5に直接乗せ、本文だけが.glass-rowカードとして見える構成にする(以前は
          ページpx-5 + このカードのp-5 + 本文.glass-rowのpx-4が重なり、横方向の
          paddingが過大だったため)。 */}
      <div className="flex flex-col">
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
      </div>

      {/* 読む: 件名→送信者→区切り線→元メール本文 */}
      <div className="flex flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold leading-snug text-slate-900">{email.subject}</h2>
          {hasDraft && <Badge tone="accent">AI下書き</Badge>}
        </div>
        <div className="mt-3 shrink-0">{senderRow}</div>
        <div className="my-4 shrink-0 border-t border-white/40" />
        {originalBodyBlock}
      </div>

      {candidateSheet}
    </div>
  );
}
