import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { Ban, CalendarPlus, Check, Hourglass, Mail, MailCheck, Receipt, Search, Star } from "lucide-react";
import { db } from "../../db/schema";
import type { EmailStatus, GmailAccount } from "../../types";
import { avatarColor, avatarInitial, isUnhandledEmail, parseSender, snippetText } from "../../lib/gmail";
import { autoSyncModeOnOpen, summarizeGmailSync, syncGmailAccount, type GmailSyncMode } from "../../lib/gmailSync";
import { formatGmailTimestamp } from "../../lib/date";
import { blockSenderRemote, unblockSenderRemote } from "../../lib/blockedSenders";
import { updateMessageState } from "../../lib/gmailMessageState";
import { planSuggestionHint } from "../../lib/mailPlanSuggestion";
import { expenseSuggestionHint } from "../../lib/expenseMailSuggestion";
import { useMailSuggestions } from "../../hooks/useMailSuggestions";
import { gmailViewCache, visibleMailsFor } from "../../lib/gmailViewCache";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { ListRow } from "../ui/ListRow";
import { ListSkeleton } from "../ui/ListSkeleton";
import { SwipeRow, type SwipeAction } from "../ui/SwipeRow";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/ToastProvider";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { useReplyWaiting } from "../../hooks/useReplyWaiting";

/** 行を押した時の行き先(react-router の Link にそのまま渡す)。 */
export interface MailLinkTarget {
  to: string;
  replace?: boolean;
  state?: unknown;
}

interface Props {
  account: GmailAccount;
  /** PC(lg以上)の一覧。1通を1行に詰めて並べる(スマホのカードのままだと1画面に6通ほどしか
   * 入らなかった — 2026-10-12 の見直し P-3)。開いたメールは同じ画面の右側に出る(GmailPage)。 */
  compact?: boolean;
  /** 右側に開いているメールのid。その行に印を付け、見える所へ寄せる。 */
  selectedMailId?: string | null;
  /** 行を押した時の行き先。省略時はメール1通の画面(/gmail/mail/:id、スマホ)。 */
  mailLink?: (id: string) => MailLinkTarget;
}

const defaultMailLink = (id: string): MailLinkTarget => ({ to: `/gmail/mail/${id}` });

type StatusFilter = "all" | "plan" | "expense" | "important" | "waiting" | "drafted" | "sent" | "read";

/** メールを開いて戻ってきた時に、一覧の見え方(検索語・絞り込み・スクロール位置)を戻すための控え。
 *
 * スマホではメールは同じタブで /gmail/mail/:id へ移るので、この一覧はいったん消える。控えが無いと
 * 1通読んで戻るたびに「すべて」の先頭に戻ってしまい、続きから見られない。
 * 読み込み直し(F5)では消えてよいのでモジュール変数に置く — localStorageに残すと、
 * 何日も前の検索語が入ったままの一覧で始まってしまう。 */
let rememberedView: {
  accountId: string;
  query: string;
  statusFilter: StatusFilter;
  /** PC(lg以上)で内部スクロールする一覧側の位置。 */
  listScroll: number;
  /** スマホでページ全体(window)がスクロールした位置。 */
  pageScroll: number;
  /** 一覧に出していた件数(「さらに表示」で増やした分。戻った時に同じ長さにしないとスクロール位置が合わない)。 */
  shown: number;
} | null = null;

/** 一覧に一度に並べる件数。2026-10-13、本人「gmailの画面になった時に毎回…画面にメールが表示されずに真っ白」
 * (iPhone。画面の上の「Gmail 同期済み」は出るが、下の一覧が何も描かれない)。直近30日ぶんを全部1枚に並べると
 * 数百通=縦に数万pxの1枚になり、iPhoneの描画が追いつかず(1枚の大きさに上限がある)、一覧ごと消えることがある。
 * 先頭からこれだけ並べ、残りは下の「さらに表示」で足す。検索・絞り込みは全件が相手(出すのだけを区切る)。 */
const MAIL_PAGE_SIZE = 50;

/** ほかの画面のカードと同じ「順にせり上がって現れる」動き(usePageMotion)を付ける、先頭の行の数。
 * 全部の行に付けると、長い一覧が数百の面になって重いので、画面に入る分だけ。残りははじめから出す。 */
const REVEAL_ROWS = 8;

/** 開いた最初の描画に並べる行の数と、残りを足すまでの時間(ミリ秒。ページが現れる動き 340ms が終わるころ)。 */
const FIRST_PAINT_ROWS = 12;
const FIRST_PAINT_SETTLE_MS = 350;

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

export function GmailInbox({ account, compact = false, selectedMailId = null, mailLink = defaultMailLink }: Props) {
  const showToast = useToast();
  // 直前にこの一覧を離れた時の見え方(同じアカウントの時だけ)。初回の描画で1度だけ読む。
  const restoredRef = useRef(rememberedView?.accountId === account.id ? rememberedView : null);
  const [query, setQuery] = useState(restoredRef.current?.query ?? "");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(restoredRef.current?.statusFilter ?? "all");
  const [shown, setShown] = useState(restoredRef.current?.shown ?? MAIL_PAGE_SIZE);
  // 開いた最初の描画は、先頭の数行だけにして、画面が現れる動きが終わるころに残りを足す(2026-10-13、本人「若干
  // Gmail だけ画面の切り替わりが遅い」)。50行を一度に描くと、ほかの画面より約0.1秒長く画面が止まっていた。
  // スクロール位置を戻す時(メールを読んで戻った時)は、戻す先の行が要るので、最初から全部並べる。
  const [settled, setSettled] = useState(
    () => (restoredRef.current?.pageScroll ?? 0) > 0 || (restoredRef.current?.listScroll ?? 0) > 0,
  );
  useEffect(() => {
    if (settled) return;
    const timer = window.setTimeout(() => setSettled(true), FIRST_PAINT_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [settled]);
  // 検索語・絞り込みを変えたら、先頭から並べ直す(控えから戻した最初の1回は、控えの件数のまま)。
  const filterChangedRef = useRef(false);
  useEffect(() => {
    if (!filterChangedRef.current) {
      filterChangedRef.current = true;
      return;
    }
    setShown(MAIL_PAGE_SIZE);
  }, [query, statusFilter, account.id]);
  const [manageBlockedOpen, setManageBlockedOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const chipsPlacedRef = useRef(false);
  // スクロール位置は、離れる時にDOMから読もうとすると参照が外れた後になることがあるので、
  // 動かすたびにここへ写しておく。
  const listScrollRef = useRef(restoredRef.current?.listScroll ?? 0);
  const scrollRestoredRef = useRef(false);
  const remembered = gmailViewCache.list?.accountId === account.id ? gmailViewCache.list : null;
  const liveEmails = useLiveQuery(
    () => (account.id ? db.syncedEmails.where("accountId").equals(account.id).reverse().sortBy("receivedAt") : []),
    [account.id],
  );
  const emails = liveEmails ?? remembered?.emails;
  const showSkeleton = useDelayedFlag(emails === undefined);

  const liveBlocked = useLiveQuery(
    () => (account.id ? db.blockedSenders.where("accountId").equals(account.id).toArray() : []),
    [account.id],
  );
  const blockedSenders = liveBlocked ?? remembered?.blocked;
  useEffect(() => {
    if (!account.id || !liveEmails) return;
    gmailViewCache.list = { accountId: account.id, emails: liveEmails, blocked: liveBlocked ?? remembered?.blocked };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, liveEmails, liveBlocked]);

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

  // 描き直すたびに全メールの差出人を読み直さない(2026-10-13)。メールかブロックの一覧が変わった時だけ作り直す。
  const visibleEmails = useMemo(() => (emails ? visibleMailsFor(emails, blockedSenders) : undefined), [emails, blockedSenders]);

  // 日時が書かれていそうなメール(端末の中の文字合わせだけで見る。AIは呼ばない —
  // src/lib/mailPlanSuggestion.ts)と、注文確認・領収書らしいメール(src/lib/expenseMailSuggestion.ts)。
  // 全件を調べる処理は重いので、画面を描いたあとに分けて求める(src/hooks/useMailSuggestions.ts)。
  // 件数が0のときは絞り込みのボタンごと出さない。
  const suggestions = useMailSuggestions(account.id, visibleEmails);
  const planSuggestions = suggestions?.plan;
  const expenseSuggestions = suggestions?.expense;
  const planSuggestionIds = useMemo(() => new Set((planSuggestions ?? []).map((email) => email.id)), [planSuggestions]);
  const expenseSuggestionIds = useMemo(
    () => new Set((expenseSuggestions ?? []).map((email) => email.id)),
    [expenseSuggestions],
  );

  // 返信を送ったのに、相手から何日も返事が無いやり取り(src/lib/replyWaiting.ts)。
  // 行に出すのは、こちらが最後に返信した相手のメール。相手から返事が来れば次の同期で外れる。
  const replyWaiting = useReplyWaiting();
  const waitingDays = new Map(
    (replyWaiting ?? []).filter((item) => item.email.accountId === account.id).map((item) => [item.email.id, item.waitingDays]),
  );

  const statusFilteredEmails = visibleEmails?.filter((email) => {
    if (statusFilter === "plan") return planSuggestionIds.has(email.id);
    if (statusFilter === "expense") return expenseSuggestionIds.has(email.id);
    if (statusFilter === "waiting") return waitingDays.has(email.id);
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
      // 画面に出ている字(「&」)で探せるように、戻した抜粋で比べる(「&amp;」のままだと当たらない)。
      snippetText(email.snippet).toLowerCase().includes(q)
    );
  });

  /** 画面を開いた時の自動同期。二重実行の見張りは syncGmailAccount 側が持っているので、
   * ヘッダーの「今すぐ同期」(全アカウントを回る)と重なっても2本は走らない。
   * 「新着はありませんでした」は出さない(quiet)。新着と失敗だけ知らせる。 */
  async function handleSync(mode: GmailSyncMode) {
    const summary = summarizeGmailSync([{ email: account.email, result: await syncGmailAccount(account, mode) }], { quiet: true });
    if (summary) showToast(summary.message, summary.tone);
  }

  // 画面を開いた瞬間に最新化する — ヘッダーの「今すぐ同期」は以降の手動リフレッシュ用として残す。
  // 連携が切れているアカウントでは走らせない。何度やっても同じ所で失敗し、赤いトーストが
  // 出るだけなので、画面上部の「つなぎ直す」の帯(GmailPage)に任せる。
  // 何をするかは autoSyncModeOnOpen(src/lib/gmailSync.ts)が決める: 前に全部の同期をしてから10分たっていれば全部、
  // それより前なら軽い確認(新着だけ)、直前(1分以内)に同期か確認をしていれば何もしない。
  // メールを開いて戻るとこの一覧は作り直されるので、これが無いと1通読むごとに同期が走る。
  useEffect(() => {
    if (account.reauthRequiredAt) return;
    const mode = autoSyncModeOnOpen(account);
    if (mode) void handleSync(mode);
  }, [account.id, account.reauthRequiredAt]);

  // 離れる時の見え方を控える。最新の値を掴めるよう、描画のたびにrefへ写しておく
  // (片付けの関数は、最初の描画の時の値を掴んだままになるため)。
  const viewRef = useRef({ query, statusFilter, shown });
  viewRef.current = { query, statusFilter, shown };
  useEffect(
    () => () => {
      rememberedView = {
        accountId: account.id ?? "",
        query: viewRef.current.query,
        statusFilter: viewRef.current.statusFilter,
        listScroll: listScrollRef.current,
        pageScroll: window.scrollY,
        shown: viewRef.current.shown,
      };
    },
    [account.id],
  );

  // 控えたスクロール位置は、行が並んでから戻す(空の一覧に対して戻しても効かない)。
  useEffect(() => {
    if (scrollRestoredRef.current || !filteredEmails || filteredEmails.length === 0) return;
    scrollRestoredRef.current = true;
    const restored = restoredRef.current;
    if (!restored) return;
    if (listRef.current) listRef.current.scrollTop = restored.listScroll;
    if (restored.pageScroll) window.scrollTo(0, restored.pageScroll);
  }, [filteredEmails]);

  // 絞り込みのチップは1段のまま横に流す(2026-10-12 の見直し S-7。以前は狭い画面で2段に
  // 折り返し、一覧の上を大きく使っていた)。入りきらない時は隠れている側の端を薄くして
  // 「まだ続きがある」と分かるようにする(ページのタブ ui/Tabs.tsx と同じ見せ方。CSS は
  // pages-warm.css の .mail-filter-chips)。PCで右にメールを開くと一覧が細くなるので、
  // 窓の大きさではなく帯そのものの幅の変化を見る。
  const chipsShown = !showSkeleton && !!emails && emails.length > 0;
  // 並んでいるチップの数(予定候補・支出候補・返信待ちは、該当がある時だけ並ぶ)。
  // 増えた・減った時も、端の薄めと選んだチップの位置を測り直す。
  const chipCount =
    5 + (planSuggestions?.length ? 1 : 0) + (expenseSuggestions?.length ? 1 : 0) + (waitingDays.size > 0 ? 1 : 0);
  useEffect(() => {
    const row = chipsRef.current;
    if (!row) return;
    const mark = () => {
      const max = row.scrollWidth - row.clientWidth;
      row.dataset.moreLeft = String(max > 1 && row.scrollLeft > 1);
      row.dataset.moreRight = String(max > 1 && row.scrollLeft < max - 1);
    };
    row.addEventListener("scroll", mark, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mark);
    // ResizeObserver は、観測を始めた直後に1回呼ばれる。ここで先に測ると、50行を並べた直後の画面の
    // 配置の計算を無理に前倒しすることになり、千通で約50ミリ秒(CPU 4倍遅く)止まっていた。
    if (observer) observer.observe(row);
    else mark();
    return () => {
      row.removeEventListener("scroll", mark);
      observer?.disconnect();
    };
  }, [chipsShown, chipCount]);

  // 選んだチップは帯の真ん中へ寄せる(右端の「既読」を選んでも隠れたままにならないように)。
  // 控えから戻した絞り込みも、チップが並んだ時点で同じように寄せる。
  useEffect(() => {
    const row = chipsRef.current;
    const selected = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !selected) return;
    if (row.scrollWidth <= row.clientWidth) return;
    const left = selected.offsetLeft - (row.clientWidth - selected.offsetWidth) / 2;
    // scrollIntoView は画面ごと縦にも動かしてしまうので、帯の中だけを動かす。
    row.scrollTo?.({ left: Math.max(0, left), behavior: chipsPlacedRef.current ? "smooth" : "auto" });
    chipsPlacedRef.current = true;
  }, [statusFilter, chipsShown, chipCount]);

  // 右に開いたメールの行を、一覧の見える所へ寄せる(PC)。通知やホームから開いた時に
  // 一覧のどこにあるか分かるように。また一覧を幅いっぱいから左の列へ細くすると行が2段に
  // なって背が伸び、押した行が下へずれて見えなくなることがあるため。行は一覧の中だけで
  // 動かす(ページごと動かさない)。一覧が並んだ後(filteredEmails が届いた後)にも1回見る。
  useEffect(() => {
    const list = listRef.current;
    if (!compact || !selectedMailId || !list) return;
    const row = Array.from(list.querySelectorAll<HTMLElement>("[data-mail-id]")).find(
      (el) => el.dataset.mailId === selectedMailId,
    );
    if (!row) return;
    const listBox = list.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (rowBox.top < listBox.top) list.scrollTop += rowBox.top - listBox.top - 8;
    else if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom + 8;
  }, [compact, selectedMailId, filteredEmails?.length]);

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
        <div data-page-block className="relative shrink-0">
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
        <div
          ref={chipsRef}
          data-page-block
          className="mail-filter-chips relative flex shrink-0 gap-1.5 overflow-x-auto"
          role="group"
          aria-label="ステータスフィルター"
        >
          {/* 1段のまま横に流す(上の useEffect)。
              「予定候補」は該当が1件も無いときは出さない — 押しても空の一覧しか出ないため。 */}
          {(
            [
              ["all", "すべて"],
              ...(planSuggestions && planSuggestions.length > 0
                ? ([["plan", `予定候補 ${planSuggestions.length}`]] as const)
                : []),
              ...(expenseSuggestions && expenseSuggestions.length > 0
                ? ([["expense", `支出候補 ${expenseSuggestions.length}`]] as const)
                : []),
              ["important", "重要"],
              // 予定候補と同じく、1件も無いときはボタンごと出さない。
              ...(waitingDays.size > 0 ? ([["waiting", `返信待ち ${waitingDays.size}`]] as const) : []),
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
              className="lh-chip"
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
      ) : emails === undefined ? null : filteredEmails && filteredEmails.length > 0 ? (
        // 末尾の余白は、右下の新規作成ボタン(FAB)に最後の行の「既読にする」が
        // 隠れないための逃げ。一覧が画面下端まで伸びるPCでだけ必要。
        <div
          ref={listRef}
          onScroll={(e) => (listScrollRef.current = e.currentTarget.scrollTop)}
          className={`relative flex flex-col lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pb-14 lg:pr-0.5 ${
            compact ? "mail-list--compact gap-1" : "gap-2"
          }`}
        >
          {filteredEmails.slice(0, settled ? shown : Math.min(shown, FIRST_PAINT_ROWS)).map((email, rowIndex) => {
            const sender = parseSender(email.from);
            const unread = email.status === "unprocessed" && !email.readAt;
            const snippet = snippetText(email.snippet);
            const link = mailLink(email.id ?? "");
            const selected = compact && !!selectedMailId && email.id === selectedMailId;
            const waiting = waitingDays.get(email.id ?? "");
            const isPlan = planSuggestionIds.has(email.id);
            const isExpense = expenseSuggestionIds.has(email.id);
            // 左へ払うと「処理済み」(UI/UX 調査メモ 第4弾 A-3)。この一覧で「片付いた」に当たる操作は
            // 既読にすること — 「すべて」は手を付けていないメール(isUnhandledEmail)で、既読にするとそこから抜けて
            // 「既読」へ移る。行の右のチェック(既読にする)と同じ操作で、ボタンが出ている行(まだ既読でない行)だけ払える。
            // アーカイブや「スキップ」は、この画面には無い(Gmail 側のラベルも変えない)。
            const swipeRead: SwipeAction | undefined = email.readAt
              ? undefined
              : { label: "既読", icon: MailCheck, tone: "complete", after: "leave", onCommit: () => email.id && handleMarkRead(email.id) };
            const markRead = email.readAt ? (
              // 既読の行にもボタンと同じ幅の空きを置く — PCの1行表示で、時刻の列が行ごとに
              // ずれないように。
              compact ? <span className="w-9 shrink-0" aria-hidden="true" /> : null
            ) : (
              <button
                type="button"
                onClick={() => email.id && handleMarkRead(email.id)}
                aria-label="既読にする"
                title="既読にする"
                className={`flex shrink-0 items-center justify-center text-slate-300 transition-colors active:bg-slate-100 active:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${
                  compact ? "w-9 hover:text-accent" : "w-11"
                }`}
              >
                <Check size={compact ? 16 : 18} />
              </button>
            );

            if (compact) {
              // PC: 1通を1行に詰める(差出人・件名・抜粋・印・時刻)。一覧の幅が狭い時(右にメールを
              // 開いている時)は、差出人と時刻の行・件名と抜粋の行の2段になる — 1段のままだと
              // 件名が数文字しか見えないため(切り替えは pages-warm.css の @container)。
              // 予定候補などの印は、文字を出すと1行に収まらないので小さな絵にし、中身は
              // 指を乗せた時の説明と読み上げに回す(開けばメール画面の帯に全部出る)。
              return (
                <SwipeRow key={email.id} left={swipeRead}>
                <div
                  key={email.id}
                  data-mail-id={email.id}
                  {...(rowIndex >= REVEAL_ROWS ? { "data-no-reveal": "" } : {})}
                  className={`mail-row mail-row--compact glass-row flex w-full items-stretch rounded-xl border-l-[3px] transition-colors ${
                    unread ? "is-unread border-l-accent" : "border-l-transparent"
                  } ${selected ? "is-selected" : ""}`}
                >
                  <Link
                    to={link.to}
                    replace={link.replace}
                    state={link.state}
                    aria-current={selected ? "true" : undefined}
                    className="mail-compact min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
                  >
                    <span className={`mail-compact__from truncate ${unread ? "font-semibold text-slate-900" : "font-medium text-slate-600"}`}>
                      {sender.name}
                    </span>
                    <span className="mail-compact__text truncate">
                      <span className={unread ? "font-semibold text-slate-800" : "font-medium text-slate-700"}>
                        {email.subject || "(件名なし)"}
                      </span>
                      {snippet && <span className="mail-compact__snippet text-slate-500">{snippet}</span>}
                    </span>
                    <span className="mail-compact__marks">
                      {!!email.importantAt && (
                        <span className="mail-mark mail-mark--icon text-warning" title="重要">
                          <Star size={13} fill="currentColor" aria-hidden="true" />
                          <span className="sr-only">重要</span>
                        </span>
                      )}
                      {email.status !== "unprocessed" && (
                        <Badge tone={STATUS_TONE[email.status]} className="mail-mark__badge">
                          {STATUS_LABEL[email.status]}
                        </Badge>
                      )}
                      {waiting !== undefined && (
                        <span className="mail-mark bg-red-50 text-danger" title={`返信待ち ${waiting}日`}>
                          <Hourglass size={12} aria-hidden="true" />
                          <span className="sr-only">返信待ち</span>
                          {waiting}日
                        </span>
                      )}
                      {isPlan && (
                        <span className="mail-mark bg-accent-light text-accent" title={`予定候補 ${planSuggestionHint(email)}`.trim()}>
                          <CalendarPlus size={13} aria-hidden="true" />
                          <span className="sr-only">{`予定候補 ${planSuggestionHint(email)}`.trim()}</span>
                        </span>
                      )}
                      {isExpense && (
                        <span className="mail-mark bg-amber-100 text-amber-700" title={`支出候補 ${expenseSuggestionHint(email)}`.trim()}>
                          <Receipt size={13} aria-hidden="true" />
                          <span className="sr-only">{`支出候補 ${expenseSuggestionHint(email)}`.trim()}</span>
                        </span>
                      )}
                    </span>
                    <span className="mail-compact__time text-xs text-slate-500">{formatGmailTimestamp(email.receivedAt)}</span>
                  </Link>
                  {markRead}
                </div>
                </SwipeRow>
              );
            }

            return (
              // 「既読にする」ボタンをリンクの外(兄弟要素)に置くため、行全体を囲むdivとリンクに
              // 分けている(button要素をa要素の中にネストするのはHTML的に不正で、挙動が環境依存になる)。
              <SwipeRow key={email.id} left={swipeRead}>
              <div
                key={email.id}
                data-mail-id={email.id}
                {...(rowIndex >= REVEAL_ROWS ? { "data-no-reveal": "" } : {})}
                className={`mail-row glass-row flex w-full items-stretch rounded-xl border-l-[3px] transition-colors ${unread ? "is-unread border-l-accent" : "border-l-transparent"}`}
              >
                {/* 同じタブで開く。新規タブに分けていた頃(2026-08-14〜)は、1通読むごとに
                    タブが増えていった。Linkのままcmd/ctrl+クリックや「新しいタブで開く」は
                    今までどおり効く(実体はhref付きのaのため)。 */}
                <Link
                  to={link.to}
                  replace={link.replace}
                  state={link.state}
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
                    <p className="mt-0.5 truncate text-xs text-slate-500">{snippet}</p>
                    {(email.status !== "unprocessed" || isPlan || isExpense || waiting !== undefined) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {email.status !== "unprocessed" && (
                          <Badge tone={STATUS_TONE[email.status]}>{STATUS_LABEL[email.status]}</Badge>
                        )}
                        {waiting !== undefined && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-danger">
                            <Hourglass size={12} />
                            返信待ち {waiting}日
                          </span>
                        )}
                        {isPlan && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent-light px-2 py-0.5 text-xs font-medium text-accent">
                            <CalendarPlus size={12} />
                            {planSuggestionHint(email) || "予定候補"}
                          </span>
                        )}
                        {isExpense && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                            <Receipt size={12} />
                            {expenseSuggestionHint(email) || "支出候補"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </Link>
                {markRead}
              </div>
              </SwipeRow>
            );
          })}
          {settled && filteredEmails.length > shown && (
            <button
              type="button"
              onClick={() => setShown((count) => count + MAIL_PAGE_SIZE)}
              className="mt-1 min-h-11 w-full rounded-xl py-2.5 text-sm font-semibold text-accent active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              さらに表示（残り{filteredEmails.length - shown}件）
            </button>
          )}
        </div>
      ) : emails && emails.length > 0 ? (
        <EmptyState title="該当する結果が見つかりませんでした" description="検索条件を変えてみてください。" />
      ) : (
        <EmptyState
          icon={Mail}
          illustration="mail"
          title="受信メールはまだありません"
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
