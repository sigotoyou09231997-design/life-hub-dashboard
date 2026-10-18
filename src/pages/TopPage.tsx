import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, ChevronRight, Mail, Plane, Plus } from "lucide-react";
import { db } from "../db/schema";
import { formatDisplayDate, toDateStr, todayStr } from "../lib/date";
import { occursOn } from "../lib/eventSpan";
import { parseSender } from "../lib/gmail";
import { pullBlockedSendersIfDue } from "../lib/blockedSenders";
import { useTripCover } from "../hooks/useTripCover";
import { usePayPeriodBudget } from "../hooks/usePayPeriodBudget";
import { useHubMotion } from "../hooks/useHubMotion";
import { useReplyWaiting } from "../hooks/useReplyWaiting";
import { useGoogleCalendarAutoSync } from "../hooks/useGoogleCalendarAutoSync";
import { useWithoutPendingDeletes } from "../hooks/usePendingDeletes";
import { useNotificationSignals } from "../lib/notificationSignals";
import { useHomeAddress } from "../lib/homePlace";
import { computeSetupProgress, isSetupChecklistSuppressed } from "../lib/setupChecklist";
import { isCalendarSyncEnabled } from "../lib/googleCalendar";
import { isUnhandledEmail } from "../lib/gmail";
import { PageFab } from "../components/ui/PageFab";
import { CountingAmount } from "../components/ui/CountingAmount";
import { openAddChooser, openQuickAdd } from "../components/layout/AddChooser";
import { InlineExpenseEntry } from "../components/home/InlineExpenseEntry";
import { TripInviteBanner } from "../components/trips/TripInviteBanner";
import { HomeAttention } from "../components/home/HomeAttention";
import { HomeWeekStrip } from "../components/home/HomeWeekStrip";
import { HomeSubscriptions } from "../components/home/HomeSubscriptions";
import { pairSubscriptions } from "../lib/subscriptions";
import { useHiddenFeatures } from "../hooks/useHiddenFeatures";
import { aheadDates, buildConcerns, homeStatusLine, homeSubscriptions, tripCardSize, tripCountdown, upcomingRows, weekStrip } from "../lib/homeLayout";

const TRIP_STATUS_LABEL: Record<string, string> = { ongoing: "旅行中", planning: "計画中", completed: "完了済み" };

/** 区切りの見出し。見出しはカードの外（参考にしたアプリの形）。 */
function SectionHead({ title, to, trailing }: { title: string; to?: string; trailing?: ReactNode }) {
  return (
    <div className="lh-section__head">
      <h2 className="lh-section__title">{title}</h2>
      {trailing}
      {to && (
        <Link to={to} className="warm-card__go">
          すべて見る <ArrowRight size={13} />
        </Link>
      )}
    </div>
  );
}

/**
 * ホーム(TOP)。2026-10-17 に Cowork の「ホームのレイアウト案」で組み直した(src/lib/homeLayout.ts)。
 *   1. 今日の1行(日付＋状態の一言。表紙ではなく見出しの大きさ)
 *   2. 今月のお金(黒、PC では左2/3)＋気になること(白、右1/3。放っておくと困ることだけ。無い日は1行)
 *   3. 今日と、この先(今日・明日・明後日の予定とタスクを1枚で)
 *   4. 次の旅行(写真。30日より先なら1行の帯)＋Gmail(未処理・重要な未読の2行)
 * 外した: 今日のまとめ(3 と Gmail に重なる)、最近使われていない機能(ふりかえりとベルで見る)、
 * LIFE HUB をそろえる(残りの項目は「気になること」へ)。中身・リンク・ボタンの働きは前と同じ。
 * DOM の順番はスマホの並び順。PC の並びは layout-teal.css のグリッドが決める。
 */
export default function TopPage() {
  const motionRef = useHubMotion<HTMLDivElement>();
  const today = todayStr();
  const dates = aheadDates(today);

  // 何日かにまたがる予定(宿泊など)は初日の date しか索引に載らないので、全部見てから絞る(src/lib/eventSpan.ts)。
  // 「削除しました・元に戻す」の5秒間は、まだ本当には消していない(src/lib/deferredDelete.ts)ので、ホームでも除く。
  const eventsResult = useWithoutPendingDeletes(
    "calendarEvents",
    useLiveQuery(() => db.calendarEvents.filter((event) => dates.some((date) => occursOn(event, date))).toArray(), [today]),
  );
  const tasksResult = useWithoutPendingDeletes(
    "tasks",
    useLiveQuery(() => db.tasks.where("dueDate").anyOf(dates).toArray(), [today]),
  );
  const tasks = (tasksResult ?? []).filter((task) => !task.parentTaskId);

  const todayEvents = (eventsResult ?? []).filter((event) => occursOn(event, today));
  const todayOpenTasks = tasks.filter((task) => task.dueDate === today && !task.completed).length;
  const statusLine = homeStatusLine(eventsResult ? todayEvents.length : undefined, tasksResult ? todayOpenTasks : undefined);

  const { data: budget } = usePayPeriodBudget();
  // 給与がまだ無い時の「今月のお金」。給与が無くても分かる今月の支出を出す(UI/UX 調査メモ A-4)。
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthSpending = useLiveQuery(async () => {
    const rows = await db.transactions.where("date").between(monthStart, today, true, true).toArray();
    const expenses = rows.filter((row) => row.type === "expense");
    const latest = [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0];
    return {
      total: expenses.reduce((sum, row) => sum + row.amount, 0),
      count: expenses.length,
      today: expenses.filter((row) => row.date === today).reduce((sum, row) => sum + row.amount, 0),
      latest: latest ? latest.store || latest.category : null,
    };
  }, [monthStart, today]);

  // 設定の「使う機能」で隠した機能は、ホームのカードも出さない(src/lib/hiddenFeatures.ts)。
  const hiddenFeatures = useHiddenFeatures();
  const hide = {
    schedule: hiddenFeatures.includes("schedule"),
    money: hiddenFeatures.includes("money"),
    gmail: hiddenFeatures.includes("gmail"),
    trips: hiddenFeatures.includes("trips"),
  };
  // Googleカレンダーの同期を入にしてあれば、開いた時に同期する(10分に1回まで)。
  useGoogleCalendarAutoSync();

  // ブロック中の送信者リストは端末ごとのローカルで、同期の対象外。TOP は受信トレイを開かずに眺める画面なので、
  // ここでも取り込む(src/lib/blockedSenders.ts)。
  const gmailAccounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);
  useEffect(() => {
    for (const account of gmailAccounts ?? []) {
      if (account.id) void pullBlockedSendersIfDue(account.id, account.email);
    }
  }, [gmailAccounts]);

  // Gmail の数字。アカウントはこの中でも読み直す — 上の gmailAccounts は読み込み中が undefined で、一瞬「未接続」が出るため。
  const gmailPreview = useLiveQuery(async () => {
    const accounts = await db.gmailAccounts.toArray();
    if (accounts.length === 0) return { connected: false, total: 0, importantUnread: 0 };
    const [blocked, allEmails] = await Promise.all([db.blockedSenders.toArray(), db.syncedEmails.toArray()]);
    const blockedSet = new Set(blocked.map((item) => `${item.accountId}:${item.email}`));
    const visible = allEmails.filter((email) => !blockedSet.has(`${email.accountId}:${parseSender(email.from).email.toLowerCase()}`));
    // 受信トレイの「すべて」タブと同じ絞り込み(まだ手を付けていないもの)。重要な未読は朝の通知と同じ数え方。
    const total = visible.filter(isUnhandledEmail).length;
    const importantUnread = visible.filter((email) => email.importantAt && !email.readAt && email.status !== "sent").length;
    return { connected: true, total, importantUnread };
  }, []);

  // 「気になること」の材料: 返信待ち・予算超えの予兆・期限切れのタスク・連携切れ・そろえるの残り。
  const replyWaiting = useReplyWaiting();
  const signals = useNotificationSignals();
  const homeAddress = useHomeAddress();
  const [setupSuppressed] = useState(() => isSetupChecklistSuppressed(Date.now()));
  const setupFacts = useLiveQuery(async () => {
    const [salaries, expenses, events, accounts] = await Promise.all([
      db.salaries.count(),
      db.transactions.filter((row) => row.type === "expense").count(),
      db.calendarEvents.count(),
      db.gmailAccounts.toArray(),
    ]);
    return { salary: salaries > 0, expense: expenses > 0, event: events > 0, googleCalendar: accounts.some(isCalendarSyncEnabled) };
  }, []);
  const setupProgress = setupFacts ? computeSetupProgress({ ...setupFacts, homeAddress: homeAddress.trim().length > 0 }, hiddenFeatures) : null;
  const concerns = buildConcerns({
    waiting: hide.gmail
      ? []
      : (replyWaiting ?? []).map((item) => ({ emailId: item.email.id ?? "", name: parseSender(item.email.from).name, waitingDays: item.waitingDays })),
    forecasts: hide.money ? [] : signals.budgetForecasts.filter((f) => f.willExceed),
    overdueTasks: hide.schedule ? 0 : signals.overdueTasks.length,
    reauthEmails: hide.gmail ? [] : (gmailAccounts ?? []).filter((account) => account.reauthRequiredAt).map((account) => account.email),
    setupItems: setupSuppressed || !setupProgress || setupProgress.complete ? [] : setupProgress.items.filter((item) => !item.done),
  });

  const tripsResult = useLiveQuery(() => db.trips.toArray(), []);
  const featuredTrip =
    tripsResult?.find((trip) => trip.status === "ongoing") ??
    [...(tripsResult ?? [])]
      .filter((trip) => trip.status === "planning")
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const tripCover = useTripCover(featuredTrip?.name ?? "", featuredTrip?.destination ?? "");
  const tripSize = featuredTrip ? tripCardSize(featuredTrip, today) : "compact";
  const tripCount = featuredTrip ? tripCountdown(featuredTrip, today) : "";
  const tripFacts = useLiveQuery(async () => {
    const id = featuredTrip?.id;
    if (!id) return null;
    const [packing, expenses, scheduleCount] = await Promise.all([
      db.tripPackingItems.where("tripId").equals(id).toArray(),
      db.tripExpenses.where("tripId").equals(id).toArray(),
      db.tripSchedule.where("tripId").equals(id).count(),
    ]);
    return {
      packed: packing.filter((item) => item.checked).length,
      packingTotal: packing.length,
      spent: expenses.reduce((sum, row) => sum + row.amount, 0),
      scheduleCount,
    };
  }, [featuredTrip?.id]);
  const tripWhen = featuredTrip ? `${formatDisplayDate(featuredTrip.startDate)} 〜 ${formatDisplayDate(featuredTrip.endDate)}` : "";

  // サブスクの「次の請求」(src/lib/subscriptions.ts の計算をそのまま使う)。お金管理を隠している時は出さない。
  const subscriptionItems = useLiveQuery(async () => pairSubscriptions(await db.fixedCosts.toArray(), await db.subscriptionDetails.toArray()), []);
  const subs = hide.money || !subscriptionItems ? { rows: [], thisMonthCharge: 0 } : homeSubscriptions(subscriptionItems, today);

  // 7日の帯と、その下の行(src/lib/homeLayout.ts)。
  const strip = weekStrip(dates, eventsResult ?? [], tasks, today);
  const upcoming = upcomingRows(eventsResult ?? [], tasks, dates);

  return (
    <div className={`warm-home lh-home${hide.money ? " lh-home--no-money" : ""}${hide.trips ? " lh-home--no-trips" : ""}${subs.rows.length === 0 ? " lh-home--no-subs" : ""}`} ref={motionRef}>
      {/* 1. 今日の1行。表紙ではなく見出しの大きさ(--fs-page)。 */}
      <header className="lh-today">
        <h1 className="lh-today__date">{formatDisplayDate(today)}</h1>
        <p className="lh-today__status">{statusLine || " "}</p>
      </header>

      {/* 2. 今月のお金(黒)。主役は残り額だけ、ほかは1行の補足。 */}
      {hide.money ? null : budget ? (
        <Link to="/records/expense" className="warm-card lh-money" data-reveal="1">
          <span className="lh-money__label">今月、あと使える</span>
          <p className={`warm-amount ${budget.remaining < 0 ? "is-negative" : ""}`}>
            <small>¥</small>
            {/* 支出を記録すると、減った額が「−¥1,280」と浮かんでから、前の残りから数え下がる(第4弾 A-5)。 */}
            <CountingAmount value={budget.remaining} resetKey={toDateStr(budget.period.periodStart)} showDelta />
          </p>
          <p className="lh-money__line">
            <span>
              1日あたり <b>¥{Math.round(Math.max(0, budget.perDayUsable)).toLocaleString()}</b>
            </span>
            <span aria-hidden="true">・</span>
            <span>
              給料日まで <b>{budget.period.daysUntilNextPayday}日</b>
            </span>
          </p>
          <span className="warm-card__foot">
            支出を見る <ArrowRight size={14} />
          </span>
        </Link>
      ) : (
        // 給与がまだ無い時。中にリンクが2つあるので、カードそのものはリンクにしない。
        <div className="warm-card lh-money is-unset" data-reveal="1">
          {monthSpending?.count === 0 ? (
            <InlineExpenseEntry />
          ) : (
            <>
              <span className="lh-money__label">今月の支出</span>
              <p className="warm-amount">
                <small>¥</small>
                <CountingAmount value={monthSpending?.total} resetKey={monthStart} showDelta />
              </p>
              <p className="lh-money__line">
                <span>
                  記録 <b>{monthSpending?.count ?? 0}件</b>
                </span>
                <span aria-hidden="true">・</span>
                <span>
                  今日 <b>¥{(monthSpending?.today ?? 0).toLocaleString()}</b>
                </span>
                {monthSpending?.latest && (
                  <>
                    <span aria-hidden="true">・</span>
                    <span>さいご {monthSpending.latest}</span>
                  </>
                )}
              </p>
              <p className="warm-amount__note">給与を入れると、給料日まで1日いくら使えるかも出ます</p>
              <div className="lh-money__actions">
                <Link to="/records/expense?new=salary" className="lh-money__cta">
                  給与を登録する
                </Link>
                <Link to="/records/expense?tab=history" className="warm-card__foot">
                  支出を見る <ArrowRight size={14} />
                </Link>
              </div>
            </>
          )}
        </div>
      )}

      {/* 2. 気になること(放っておくと困ることだけ)。無い日は1行で、カードは出さない。 */}
      <section className="lh-section lh-section--concern" data-reveal="2" aria-label="気になること">
        <SectionHead title="気になること" />
        <HomeAttention concerns={concerns} />
      </section>

      {/* 別のアカウントから届いた、旅行への招待(supabase/sql/034)。無い間は何も出ない。 */}
      <TripInviteBanner />

      {/* 3. 今日と、この先: 7日の帯と、この先の予定・タスク(最大4行)。 */}
      {!hide.schedule && (
        <section className="lh-section lh-section--ahead" data-reveal="3">
          <SectionHead title="今日と、この先" to="/schedule?view=calendar" />
          <HomeWeekStrip days={strip} rows={upcoming} ready={eventsResult !== undefined && tasksResult !== undefined} onAdd={(kind) => openQuickAdd(kind)} />
        </section>
      )}

      {/* 4. 次の旅行。旅行があればいつも写真のカード(30日より先は高さを控えめに)。大きな文字は「あと◯日」「N日目」。 */}
      {!hide.trips && (
        <section className={`lh-section lh-section--trip${tripSize === "compact" ? " is-compact" : ""}`} data-reveal="4">
          <SectionHead title="次の旅行" to="/trips" />
          {tripsResult === undefined ? (
            <div className="warm-trip is-compact lh-trip-loading" aria-hidden="true" />
          ) : featuredTrip ? (
            <Link to={featuredTrip.id ? `/trips/${featuredTrip.id}` : "/trips"} className={`warm-trip${tripSize === "compact" ? " is-compact" : ""}`}>
              <div className="warm-trip__photo" style={{ backgroundImage: `url('${tripCover.url}')` }} aria-hidden="true" />
              <div className="warm-trip__veil" aria-hidden="true" />
              <span className="warm-trip__kicker">
                <Plane size={13} strokeWidth={2.2} />
                {TRIP_STATUS_LABEL[featuredTrip.status]}
              </span>
              <p className="warm-trip__place">{featuredTrip.name || featuredTrip.destination}</p>
              {tripCount && <p className="warm-trip__count">{tripCount}</p>}
              <p className="warm-trip__when warm-trip__facts">
                <span>{tripWhen}</span>
                {tripFacts && (
                  <>
                    <span>持ち物 {tripFacts.packed}/{tripFacts.packingTotal}</span>
                    <span>
                      {tripFacts.spent > 0 || !featuredTrip.budget
                        ? `使った額 ¥${Math.round(tripFacts.spent).toLocaleString()}`
                        : `予算 ¥${Math.round(featuredTrip.budget).toLocaleString()}`}
                    </span>
                    <span>予定 {tripFacts.scheduleCount}件</span>
                  </>
                )}
              </p>
            </Link>
          ) : (
            <Link to="/trips" className="warm-trip is-compact">
              <div className="warm-trip__photo" aria-hidden="true" />
              <div className="warm-trip__veil" aria-hidden="true" />
              <span className="warm-trip__kicker">
                <Plane size={13} strokeWidth={2.2} />
                次の旅
              </span>
              <p className="warm-trip__place">次はどこへ</p>
              <p className="warm-trip__when">旅の計画を立てましょう</p>
            </Link>
          )}
        </section>
      )}

      {/* 4. サブスクの次の請求。登録が0件ならカードごと出さない。 */}
      {subs.rows.length > 0 && (
        <section className="lh-section lh-section--subs" data-reveal="4">
          <SectionHead title="次の請求" to="/records/expense?tab=subs" />
          <HomeSubscriptions rows={subs.rows} thisMonthCharge={subs.thisMonthCharge} />
        </section>
      )}

      {/* 4. Gmail。未処理と重要な未読の2行と「開く」。 */}
      {!hide.gmail && (
        <section className="lh-section lh-section--gmail" data-reveal="5">
          <SectionHead title="Gmail" to={gmailPreview?.connected ? "/gmail" : undefined} />
          <div className="warm-card lh-group">
            {gmailPreview?.connected ? (
              gmailPreview.total === 0 && gmailPreview.importantUnread === 0 ? (
                // 0件の行は並べない。両方0なら1行だけ。
                <p className="lh-gmail-clear">新着はありません</p>
              ) : (
                <>
                  {gmailPreview.total > 0 && (
                    <Link to="/gmail" className="lh-row">
                      <span className="lh-row__icon lh-tone--neutral" aria-hidden="true">
                        <Mail size={16} />
                      </span>
                      <span className="lh-row__copy">
                        <strong>未処理 {gmailPreview.total}件</strong>
                        <small>まだ手を付けていないメール</small>
                      </span>
                      <ChevronRight className="lh-row__chev" size={16} aria-hidden="true" />
                    </Link>
                  )}
                  {gmailPreview.importantUnread > 0 && (
                    <Link to="/gmail" className="lh-row">
                      <span className="lh-row__icon lh-tone--danger" aria-hidden="true">
                        <Mail size={16} />
                      </span>
                      <span className="lh-row__copy">
                        <strong>重要な未読 {gmailPreview.importantUnread}件</strong>
                        <small>「重要」を付けたまま、まだ読んでいないメール</small>
                      </span>
                      <ChevronRight className="lh-row__chev" size={16} aria-hidden="true" />
                    </Link>
                  )}
                </>
              )
            ) : (
              <div className="warm-empty">
                <span className="warm-empty__icon">
                  <Mail size={18} />
                </span>
                <div className="min-w-0">
                  <strong>Gmailを接続</strong>
                  <p>最新メールと返信案をここで確認</p>
                </div>
              </div>
            )}
            <Link to="/gmail" className="lh-row lh-row--foot">
              <span className="lh-row__copy">
                <strong>{gmailPreview?.connected ? "開く" : "接続画面を開く"}</strong>
              </span>
              <ChevronRight className="lh-row__chev" size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}

      {/* 追加の入口(UI/UX 調査メモ A-3)。ホームは何を足すか決まらないので、選ぶシートを開く。 */}
      <PageFab onClick={openAddChooser} label="追加する">
        <Plus size={24} />
      </PageFab>
    </div>
  );
}
