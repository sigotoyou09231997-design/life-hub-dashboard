import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, ChevronLeft, CheckCircle2, Mail, Plus, RefreshCw, Settings as SettingsIcon, Sparkles, X } from "lucide-react";
import { db } from "../db/schema";
import { AREA_ACCENT_STYLE } from "../lib/areaColors";
import { GmailLogo } from "../components/gmail/GmailLogo";
import { Tabs } from "../components/ui/Tabs";
import { Card } from "../components/ui/Card";
import { Sheet } from "../components/ui/Sheet";
import { PageFab } from "../components/ui/PageFab";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { GmailInbox, type MailLinkTarget } from "../components/gmail/GmailInbox";
import { DraftReview } from "../components/gmail/DraftReview";
import { startGmailOAuth } from "../lib/gmail";
import { pullBlockedSenders } from "../lib/blockedSenders";
import {
  consolidateGmailAccounts,
  readSelectedGmailAccountId,
  rememberSelectedGmailAccountId,
  resolveSelectedGmailAccountId,
} from "../lib/gmailAccounts";
import { summarizeGmailSync, syncGmailAccount, type AccountSyncOutcome } from "../lib/gmailSync";
import { ComposeMail } from "../components/gmail/ComposeMail";
import { useToast } from "../components/ui/ToastProvider";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { PullToRefreshIndicator } from "../components/ui/PullToRefreshIndicator";
import { recordRecent } from "../lib/recentItems";

const BACK_BUTTON_CLASS =
  "-ml-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

/** PCで一覧からメールを開いた時に、履歴(location.state)へ付ける印。これがある時だけ
 * 「閉じる」をブラウザの「戻る」と同じにする(直前の履歴が、この一覧だと分かっているため)。 */
interface SplitHistoryState {
  gmailMailFromList?: boolean;
}

/** PC(lg以上)で、一覧の右側に出すメール1通(本文と返信)。
 *
 * 中身はスマホの /gmail/mail/:id(GmailMailPage)と同じ DraftReview。左右に並べるだけの幅は
 * 無いので stacked(本文 → 返信の縦1列)にし、この枠の中だけでスクロールする — 一覧の
 * 位置を動かさずに、長いメールも最後まで読めるように。 */
function MailReadingPane({ emailId, onClose }: { emailId: string; onClose: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // undefined = 読み込み中、null = メール(またはそのアカウント)が見つからない(古いリンクなど)。
  const data = useLiveQuery(async () => {
    const email = await db.syncedEmails.get(emailId);
    if (!email) return null;
    const account = await db.gmailAccounts.get(email.accountId);
    if (!account) return null;
    return { email, account };
  }, [emailId]);

  // 別のメールに切り替えたら、前のメールで下まで読んだ位置を持ち越さずに先頭から出す。
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [emailId]);

  return (
    <section className="mail-reading-pane" aria-label="開いているメール">
      <div className="mail-reading-pane__bar">
        <button
          type="button"
          onClick={onClose}
          className="mail-reading-pane__close focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <X size={16} aria-hidden="true" />
          閉じる
        </button>
      </div>
      <div ref={scrollRef} className="mail-reading-pane__scroll">
        {data === undefined ? (
          <ListSkeleton />
        ) : data === null ? (
          <EmptyState icon={Mail} title="メールが見つかりません" description="左の一覧から選び直してください" />
        ) : (
          // メールごとに作り直す。DraftReview は宛先・AIへの指示などを開いた時に1回だけ
          // 読み込むので、同じ部品のまま別のメールを渡すと前のメールの宛先が残ってしまう。
          <DraftReview key={data.email.id} email={data.email} account={data.account} stacked />
        )}
      </div>
    </section>
  );
}

export default function GmailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isDesktop = useIsDesktop();
  const showToast = useToast();
  const accounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);
  const showSkeleton = useDelayedFlag(accounts === undefined);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(() => readSelectedGmailAccountId());
  const [syncing, setSyncing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  // 前回開いた時に選んでいたアカウントを、今ある連携アカウントと突き合わせて確定させる
  // (src/lib/gmailAccounts.ts)。連携解除などで消えていれば1件目に戻る。
  useEffect(() => {
    if (!accounts) return;
    const resolved = resolveSelectedGmailAccountId(accounts, selectedAccountId);
    if (resolved !== selectedAccountId) setSelectedAccountId(resolved);
  }, [accounts, selectedAccountId]);

  // 選択が決まったら覚える。タブを押した時だけでなく、上の突き合わせで1件目に戻された
  // 時も通るので、次にこの画面を開いた時は必ず今見ているアカウントから始まる。
  useEffect(() => {
    if (selectedAccountId) rememberSelectedGmailAccountId(selectedAccountId);
  }, [selectedAccountId]);

  // ブロック中の送信者リストは端末ごとのローカル(db.blockedSenders)で、汎用同期エンジンの
  // 対象外。他端末でのブロック/解除をここで取り込む(src/lib/blockedSenders.ts参照) —
  // これが無いと、PCでブロックした送信者がスマホの一覧にはそのまま出続ける。
  useEffect(() => {
    for (const account of accounts ?? []) {
      if (account.id) void pullBlockedSenders(account.id, account.email);
    }
  }, [accounts]);

  // 連携し直しで増えてしまった重複アカウントと、どのアカウントにも属さない
  // メール/下書き/ブロックリストを片付ける(src/lib/gmailAccounts.ts)。
  useEffect(() => {
    void consolidateGmailAccounts();
  }, []);

  const selectedAccount = accounts?.find((a) => a.id === selectedAccountId);

  // ---- PC: 一覧の右にメールを開く(2026-10-12 の見直し P-3) ----
  // 以前はPCでも、メールを押すと別の画面(/gmail/mail/:id)へ移っていた。PCでは同じ画面の
  // 右側に開き、どのメールを開いているかは /gmail?mail=<id> で表す(読み込み直し・
  // ブックマークでも同じメールが開く)。パスを /gmail のまま変えないのは、ページを
  // 作り直さずに右側だけを差し替えるため(App.tsx はパスが変わると画面ごと作り直す)。
  // スマホは今までどおり、メール1通の画面へ移る。
  const openMailId = searchParams.get("mail");
  const paneOpen = isDesktop && !!openMailId;
  const fromList = !!(location.state as SplitHistoryState | null)?.gmailMailFromList;

  // スマホ幅で /gmail?mail=<id> を開いた時(PCで窓を狭めた時など)は、メール1通の画面へ移す。
  useEffect(() => {
    if (!isDesktop && openMailId) navigate(`/gmail/mail/${encodeURIComponent(openMailId)}`, { replace: true });
  }, [isDesktop, openMailId, navigate]);

  // 開いたメールが別のアカウントのもの(通知・ホーム・検索から開いた時)なら、左の一覧も
  // そのアカウントに切り替える。開いたメールが変わった時だけ合わせる — 合わせ続けると、
  // タブで別のアカウントを選べなくなる。
  const openMailAccountId = useLiveQuery(
    async () => (openMailId ? ((await db.syncedEmails.get(openMailId))?.accountId ?? null) : null),
    [openMailId],
  );
  useEffect(() => {
    if (paneOpen && openMailAccountId) setSelectedAccountId(openMailAccountId);
  }, [paneOpen, openMailAccountId]);

  // 「最近見たもの」(まとめて検索)に残す。スマホの /gmail/mail/:id はURLのパスから拾われる
  // (GlobalSearch.tsx)が、PCはパスが /gmail のままなので、ここで残す。
  useEffect(() => {
    if (paneOpen && openMailId) recordRecent({ kind: "email", id: openMailId });
  }, [paneOpen, openMailId]);

  /** PCの一覧の行の行き先。1通目を開く時だけ履歴に積み、ブラウザの「戻る」でメールを閉じて
   * 一覧だけに戻れるようにする。開いたまま別のメールへ切り替える時は積まずに置き換える —
   * 積んでいくと、10通読んだ後は「戻る」を10回押さないと前の画面へ戻れなくなる。 */
  const splitMailLink = useCallback(
    (id: string): MailLinkTarget => ({
      to: `/gmail?mail=${encodeURIComponent(id)}`,
      replace: !!openMailId,
      state: openMailId ? location.state : ({ gmailMailFromList: true } satisfies SplitHistoryState),
    }),
    [openMailId, location.state],
  );

  /** 右のメールを閉じて、一覧だけに戻す。一覧から開いた時は「戻る」と同じ(履歴を1つ戻す)。
   * 通知などから直に開いた時は、直前の履歴がこの一覧ではないので、置き換えで閉じる。 */
  const closeMail = useCallback(() => {
    if (fromList) navigate(-1);
    else navigate("/gmail", { replace: true });
  }, [fromList, navigate]);

  // Googleの更新用トークンが切れたアカウント(src/lib/gmailSync.ts が印を付ける)。
  // 印がある間、自動同期は止まっている — つなぎ直す場所がここにしか無いので、
  // 一覧の上に出しっぱなしの帯にする(トーストは数秒で消えてしまう)。
  const reauthAccounts = (accounts ?? []).filter((a) => a.reauthRequiredAt);

  // 「自動下書き」＝新着メール同期時にAI下書きを自動生成するかどうか。
  // 通知(プッシュ)設定とは別のsettings.autoDraftEnabledを使う — 同じ値を共有しない。
  // 送信は行わない: これをONにしても、送信は必ずDraftReview側で本人が
  // 「送信する」を押した場合のみ実行される。
  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);
  const autoDraftEnabled = settings?.autoDraftEnabled ?? false;

  async function handleToggleAutoDraft(next: boolean) {
    if (!settings?.id) return;
    await db.settings.update(settings.id, { autoDraftEnabled: next });
    showToast(next ? "自動下書きを有効にしました" : "自動下書きを無効にしました");
  }

  /** ヘッダーの「今すぐ同期」。連携している全アカウントを順に同期する — 表示中の
   * アカウントだけを同期していた頃は、裏のアカウントの新着はこのボタンでは取り込めず、
   * 2分ごとのバックグラウンド処理を待つしかなかった(2026-08-25 修正)。
   *
   * 並列ではなく順番に投げるのは、Gmail APIの1分あたりの上限に当たると同期そのものが
   * 失敗するため(src/lib/gmailSync.ts の取得件数・同時実行数の絞り込みと同じ理由)。
   * 見ている一覧が先に新しくなるよう、表示中のアカウントから始める。 */
  async function handleSyncClick() {
    if (!accounts || accounts.length === 0) return;
    const ordered = [
      ...accounts.filter((a) => a.id === selectedAccountId),
      ...accounts.filter((a) => a.id !== selectedAccountId),
    ];
    setSyncing(true);
    try {
      const outcomes: AccountSyncOutcome[] = [];
      for (const account of ordered) {
        outcomes.push({ email: account.email, result: await syncGmailAccount(account) });
      }
      const summary = summarizeGmailSync(outcomes);
      if (summary) showToast(summary.message, summary.tone);
    } finally {
      setSyncing(false);
    }
  }

  // 一覧を下へ引っ張ると「今すぐ同期」と同じ同期を走らせる(UI/UX 調査メモ 第4弾 A-7)。指で触った時だけ。
  // つないだアカウントが無い時は、同期するものが無いので引っ張れない。
  const pull = usePullToRefresh(handleSyncClick, { disabled: !accounts || accounts.length === 0 });

  const autoDraftToggle = (
    <button
      type="button"
      onClick={() => handleToggleAutoDraft(!autoDraftEnabled)}
      aria-pressed={autoDraftEnabled}
      aria-label="自動下書きを切り替え"
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 ${
        autoDraftEnabled ? "bg-accent" : "bg-slate-300"
      }`}
    >
      <span
        className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          autoDraftEnabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );

  return (
    <div ref={pull.containerRef} className="spatial-page mail-page micro-contrast mx-auto pb-10 lg:flex lg:h-full lg:min-h-0 lg:max-w-[1480px] lg:flex-col lg:pb-0" style={AREA_ACCENT_STYLE.gmail}>
      <PullToRefreshIndicator ref={pull.indicatorRef} phase={pull.phase} />
      <div className="mail-page-header flex items-center justify-between gap-2 px-5 pb-4 pt-6 lg:shrink-0 lg:px-8 lg:pb-5 lg:pt-7">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => navigate("/")} aria-label="戻る" className={`${BACK_BUTTON_CLASS} lg:hidden`}>
            <ChevronLeft size={22} />
          </button>
          <GmailLogo size={22} />
          <h1 className="truncate text-xl font-semibold tracking-[-0.02em] text-slate-900 lg:text-[1.65rem]">Gmail</h1>
          {selectedAccount && (
            selectedAccount.reauthRequiredAt ? (
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-danger">
                <AlertCircle size={14} />
                連携切れ
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600">
                <CheckCircle2 size={14} />
                同期済み
              </span>
            )
          )}
        </div>

        {selectedAccount && (
          <>
            {/* PC: 参考画像どおり、文字ラベル付きのガラスボタン(44px以上)を並べる */}
            <div className="hidden items-center gap-2.5 lg:flex">
              <div className="glass-row flex items-center gap-2 rounded-full px-3.5 py-2.5">
                <span className="text-xs font-medium text-slate-600">自動下書き</span>
                {autoDraftToggle}
              </div>
              <button
                type="button"
                onClick={handleSyncClick}
                disabled={syncing}
                className="glass-row flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-slate-600 transition-colors active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50"
              >
                <RefreshCw size={16} className={syncing ? "animate-spin motion-reduce:animate-none" : ""} />
                今すぐ同期
              </button>
              <button
                type="button"
                onClick={() => navigate("/settings")}
                className="glass-row flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-slate-600 transition-colors active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <SettingsIcon size={16} />
                設定
              </button>
            </div>

            {/* スマホ/タブレット: タイトルと同じ行に収める。Gmail設定は共通ヘッダーの
                設定アイコンから開けるため、ここでは重複させない(今すぐ同期のみ)。 */}
            <div className="flex shrink-0 items-center gap-2 lg:hidden">
              <div className="hidden items-center gap-2 sm:flex">
                <span className="text-xs font-medium text-slate-500">自動下書き</span>
                {autoDraftToggle}
              </div>
              <button
                type="button"
                onClick={handleSyncClick}
                disabled={syncing}
                aria-label="今すぐ同期"
                className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50"
              >
                <RefreshCw size={18} className={syncing ? "animate-spin motion-reduce:animate-none" : ""} />
              </button>
            </div>
          </>
        )}
      </div>

      <div className="mail-workspace px-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:px-8 lg:pb-7">
        {showSkeleton ? (
          <ListSkeleton />
        ) : !accounts || accounts.length === 0 ? (
          // 未接続のときはこのカード1枚しか出ず、下に背景写真だけの帯が
          // 画面の6割ほど残っていた(1440x900で534px)。空状態を画面の残りの高さまで
          // 伸ばす共通クラス(index.css)で、他の画面と同じ扱いにする。タブが無い
          // ページなので --plain の方を使う(旅行計画の一覧と同じ)。
          <Card className="mail-connection-module is-empty-fill-self is-empty-fill--plain relative mx-auto mt-4 flex w-full max-w-5xl flex-col justify-center overflow-visible p-0 lg:mt-7">
            <div className="mail-connect-control">
              <div className="mail-connect-visual" aria-hidden="true">
                <div className="mail-connect-visual__icon"><Mail size={20} /></div>
                <div className="mail-connect-visual__preview"><i /><i /><i /></div>
                <span>未接続</span>
              </div>
              <div className="mail-connect-copy min-w-0">
                <p className="mail-connect-kicker"><i />接続状態</p>
                <h2>Gmail未接続</h2>
                <p>接続すると、受信メールとAI返信案をこの画面で確認できます。</p>
                <div className="mail-connect-capability"><Sparkles size={13} /><span>AI返信</span><strong>利用不可</strong></div>
              </div>
              <div className="mail-connect-action">
                <span><i />未接続</span>
                <button type="button" onClick={() => navigate("/settings")} className="app-button rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 ease-out active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none motion-reduce:active:translate-y-0">
                  Gmailを接続 →
                </button>
              </div>
            </div>
          </Card>
        ) : (
          <>
            {reauthAccounts.length > 0 && (
              <div className="mt-4 mb-4 flex flex-col gap-3 rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                    <AlertCircle size={16} className="shrink-0 text-danger" />
                    Gmailの連携が切れています
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {reauthAccounts.map((a) => a.email).join("、")} のメールをいま取り込めません。
                    つなぎ直すまで自動同期は止めています。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => startGmailOAuth()}
                  className="app-button shrink-0 rounded-lg bg-danger px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 ease-out active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50 motion-reduce:transition-none motion-reduce:active:translate-y-0"
                >
                  つなぎ直す
                </button>
              </div>
            )}

            {accounts.length > 1 && (
              <div className="mb-4">
                <Tabs
                  options={accounts.map((a) => ({ value: String(a.id), label: a.email }))}
                  value={selectedAccountId ?? ""}
                  onChange={(v) => {
                    setSelectedAccountId(v);
                    // 右に開いているのは前のアカウントのメールなので閉じる(一覧と食い違わないように)。
                    if (paneOpen) closeMail();
                  }}
                  // ここだけ文字を小さくする。ラベルがメールアドレスで、長さが
                  // 決まらない唯一のタブのため(大きさは他の画面と同じ)。
                  dense
                />
              </div>
            )}

            {selectedAccount && (
              // PC: メールを開いていない間は一覧を幅いっぱいに(1通1行)、開いたら左に一覧・
              // 右にメールの2列にする(pages-warm.css の .mail-split)。何も開いていない時に
              // 右半分を「選んでください」の空き地にしないのは、一覧を1行で読める幅を残すため。
              // 一覧は開いても閉じても同じ場所に置いたまま(作り直さない) — 絞り込み・検索語・
              // スクロール位置がそのまま残る。
              <div className={`mail-split ${paneOpen ? "is-open" : ""}`}>
                <div className="mail-inbox-workspace lg:flex lg:min-h-0 lg:flex-col">
                  <GmailInbox
                    account={selectedAccount}
                    compact={isDesktop}
                    selectedMailId={paneOpen ? openMailId : null}
                    mailLink={isDesktop ? splitMailLink : undefined}
                  />
                </div>
                {paneOpen && openMailId && <MailReadingPane emailId={openMailId} onClose={closeMail} />}
              </div>
            )}
          </>
        )}
      </div>

      {selectedAccount && (
        <PageFab onClick={() => setComposeOpen(true)} label="新規メールを作成">
          <Plus size={24} />
        </PageFab>
      )}

      {selectedAccount && (
        <Sheet open={composeOpen} onClose={() => setComposeOpen(false)} title="新規メールを作成">
          <ComposeMail account={selectedAccount} onSent={() => setComposeOpen(false)} />
        </Sheet>
      )}
    </div>
  );
}
