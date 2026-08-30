import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Ban, CalendarPlus, Check, Mail, Search } from "lucide-react";
import { db } from "../../db/schema";
import type { EmailStatus, GmailAccount } from "../../types";
import { avatarColor, avatarInitial, isUnhandledEmail, parseSender } from "../../lib/gmail";
import { summarizeGmailSync, syncGmailAccount } from "../../lib/gmailSync";
import { formatGmailTimestamp } from "../../lib/date";
import { blockSenderRemote, unblockSenderRemote } from "../../lib/blockedSenders";
import { updateMessageState } from "../../lib/gmailMessageState";
import { pickPlanSuggestions, planSuggestionHint } from "../../lib/mailPlanSuggestion";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { ListRow } from "../ui/ListRow";
import { ListSkeleton } from "../ui/ListSkeleton";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/ToastProvider";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";

interface Props {
  account: GmailAccount;
}

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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "plan" | "important" | "drafted" | "sent" | "read">("all");
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

  // blockSenderRemote() is fire-and-forget (see src/lib/blockedSenders.ts) — if that
  // one push fails (offline, Supabase session not ready yet, transient error), the
  // sender stays blocked locally forever but never reaches checkGmailAndNotify.ts's
  // server-side filter, so background push notifications keep arriving for a sender
  // the app already shows as blocked. Retrying the push each time this list loads is
  // a cheap, idempotent self-heal for that gap.
  //
  // Only rows without a pushedAt stamp are retried. Re-pushing confirmed ones would
  // undo an unblock made on another device (that unblock deletes the server row; a
  // blind re-upsert from here would put it straight back) — see pullBlockedSenders.
  useEffect(() => {
    if (!blockedSenders) return;
    for (const b of blockedSenders) {
      if (b.pushedAt == null) void blockSenderRemote(account.email, b.email, b.id);
    }
  }, [blockedSenders, account.email]);

  const visibleEmails = emails?.filter((email) => !blockedSet.has(parseSender(email.from).email.toLowerCase()));

  // 日時が書かれていそうなメール(端末の中の文字合わせだけで見る。AIは呼ばない —
  // src/lib/mailPlanSuggestion.ts)。件数が0のときは絞り込みのボタンごと出さない。
  const planSuggestions = visibleEmails ? pickPlanSuggestions(visibleEmails) : undefined;
  const planSuggestionIds = new Set((planSuggestions ?? []).map((email) => email.id));

  const statusFilteredEmails = visibleEmails?.filter((email) => {
    if (statusFilter === "plan") return planSuggestionIds.has(email.id);
    // 重要タブは、既読にしても返信しても残す — 後で見返すために付ける印なので、
    // 他のタブのように状態が進んだら消える、という扱いにはしない。
    if (statusFilter === "important") return !!email.importantAt;
    if (statusFilter === "drafted") return email.status === "drafted" || email.status === "edited";
    if (statusFilter === "sent") return email.status === "sent";
    // 既読タブからも返信済みは外す — 返信を送った時点でそのメールは「送信済み」へ移る、
    // という見え方に揃える(以前は既読にしてから返信すると、送信済みと既読の両方に
    // 残り続けていた)。
    if (statusFilter === "read") return !!email.readAt && email.status !== "sent";
    // "すべて" = まだ手を付けていないメール。条件そのものはsrc/lib/gmail.tsに置いて
    // TOPのGmailカードと共有する — 別々に書いていた頃は、受信トレイでは片付いている
    // メールがTOPにだけ残り続けていた。
    return isUnhandledEmail(email);
  });

  const filteredEmails = statusFilteredEmails?.filter((email) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      email.from.toLowerCase().includes(q) ||
      email.subject.toLowerCase().includes(q) ||
      email.snippet.toLowerCase().includes(q)
    );
  });

  /** 画面を開いた時の自動同期。二重実行の見張りは syncGmailAccount 側が持っているので、
   * ヘッダーの「今すぐ同期」(全アカウントを回る)と重なっても2本は走らない。 */
  async function handleSync() {
    const summary = summarizeGmailSync([{ email: account.email, result: await syncGmailAccount(account) }]);
    if (summary) showToast(summary.message, summary.tone);
  }

  // 画面を開いた瞬間に最新化する — ヘッダーの「今すぐ同期」は以降の手動リフレッシュ用として残す。
  // 連携が切れているアカウントでは走らせない。何度やっても同じ所で失敗し、赤いトーストが
  // 出るだけなので、画面上部の「つなぎ直す」の帯(GmailPage)に任せる。
  useEffect(() => {
    if (account.reauthRequiredAt) return;
    void handleSync();
  }, [account.id, account.reauthRequiredAt]);

  async function handleUnblock(id: string, email: string) {
    await db.blockedSenders.delete(id);
    void unblockSenderRemote(account.email, email);
    showToast("ブロックを解除しました");
  }

  // 既読になるのは、この一覧のチェックボタンか、メール画面(DraftReview)の既読ボタンを
  // 本人が押した時だけ — 開いただけでは既読にしない(2026-08-23にその自動既読化は廃止)。
  // readAtは「すべて」タブの除外/「既読」タブの表示にも使われるため、押すとその場で
  // この一覧(「すべて」時)から消える。
  async function handleMarkRead(id: string) {
    const email = await db.syncedEmails.get(id);
    if (!email) return;
    await updateMessageState(account.email, email, { readAt: Date.now() });
    showToast("既読にしました");
  }

  return (
    // 他の一覧画面(メモ・収支等)と同じく、外側を1枚のglass-cardで包まない —
    // ページ自身のpx-5に直接乗せることで、各行(.glass-row)だけがカードに見える構成に
    // 揃える(以前はここにglass-card+p-4を重ねていたため、横方向のpaddingが他の
    // 一覧画面より大きく見えていた)。lg以上は高さを親グリッドに合わせて固定し、
    // リスト部分だけが内部スクロールする(検索・タブ・ブロック中リンクは常に見える)。
    // lg未満(モバイル)はflex-colのまま自然に積み重なり、ページ全体でスクロールする。
    <div className="mail-inbox flex flex-col gap-3 lg:h-full lg:min-h-0">
      {!showSkeleton && emails && emails.length > 0 && (
        <div className="relative shrink-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="メールを検索"
          className="field-shell w-full !pl-9"
          />
        </div>
      )}

      {!showSkeleton && emails && emails.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1.5" role="group" aria-label="ステータスフィルター">
          {/* 5つ並ぶと狭い画面では1行に収まらないので折り返す(横スクロールにはしない)。
              「予定候補」は該当が1件も無いときは出さない — 押しても空の一覧しか出ないため。 */}
          {(
            [
              ["all", "すべて"],
              ...(planSuggestions && planSuggestions.length > 0
                ? ([["plan", `予定候補 ${planSuggestions.length}`]] as const)
                : []),
              ["important", "重要"],
              ["drafted", "AI下書き"],
              ["sent", "送信済み"],
              ["read", "既読"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              aria-pressed={statusFilter === value}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                statusFilter === value
                  ? "border-accent bg-accent-light text-accent"
                  : "border-white/50 text-slate-500 hover:border-white/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {blockedSenders && blockedSenders.length > 0 && (
        <button
          type="button"
          onClick={() => setManageBlockedOpen(true)}
          className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <Ban size={13} />
          ブロック中の送信者({blockedSenders.length})
        </button>
      )}

      {showSkeleton ? (
        <ListSkeleton />
      ) : filteredEmails && filteredEmails.length > 0 ? (
        // 末尾の余白は、右下の新規作成ボタン(FAB)に最後の行の「既読にする」が
        // 隠れないための逃げ。一覧が画面下端まで伸びるPCでだけ必要。
        <div className="flex flex-col gap-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pb-14 lg:pr-0.5">
          {filteredEmails.map((email) => {
            const sender = parseSender(email.from);
            const unread = email.status === "unprocessed" && !email.readAt;
            return (
              // 「既読にする」ボタンをaの外(兄弟要素)に置くため、行全体を囲むdivとaに分けている
              // (button要素をa要素の中にネストするのはHTML的に不正で、挙動が環境依存になる)。
              <div
                key={email.id}
                className={`mail-row glass-row flex w-full items-stretch rounded-xl border-l-[3px] transition-colors ${unread ? "is-unread border-l-accent" : "border-l-transparent"}`}
              >
                <a
                  href={`/gmail/mail/${email.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 active:bg-white/60"
                >
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(sender.email)}`}
                  >
                    {avatarInitial(sender.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={`truncate text-sm ${unread ? "font-semibold text-slate-900" : "font-medium text-slate-600"}`}>
                        {sender.name}
                      </p>
                      <span className="shrink-0 text-xs text-slate-500">{formatGmailTimestamp(email.receivedAt)}</span>
                    </div>
                    <p className={`mt-0.5 truncate text-sm ${unread ? "font-medium text-slate-800" : "text-slate-600"}`}>
                      {email.subject}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{email.snippet}</p>
                    {(email.status !== "unprocessed" || planSuggestionIds.has(email.id)) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {email.status !== "unprocessed" && (
                          <Badge tone={STATUS_TONE[email.status]}>{STATUS_LABEL[email.status]}</Badge>
                        )}
                        {planSuggestionIds.has(email.id) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent-light px-2 py-0.5 text-xs font-medium text-accent">
                            <CalendarPlus size={12} />
                            {planSuggestionHint(email) || "予定候補"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </a>
                {!email.readAt && (
                  <button
                    type="button"
                    onClick={() => email.id && handleMarkRead(email.id)}
                    aria-label="既読にする"
                    title="既読にする"
                    className="flex w-11 shrink-0 items-center justify-center text-slate-300 transition-colors active:bg-slate-100 active:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
                  >
                    <Check size={18} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : emails && emails.length > 0 ? (
        <EmptyState title="該当する結果が見つかりませんでした" description="検索条件を変えてみてください。" />
      ) : (
        <EmptyState
          icon={Mail}
          title="メールがありません"
          description="「今すぐ同期」を押すと直近30日分の受信メールを取得します"
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
