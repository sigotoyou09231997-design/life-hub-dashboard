import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { ArrowRight, CalendarDays, Check, ChevronRight, Mail, Plane, Plus } from "lucide-react";
import { db } from "../db/schema";
import type { CalendarEvent, Task } from "../types";
import { formatDisplayDate, formatShortDate, toDateStr, todayStr } from "../lib/date";
import { occursOn, spanDayIndex, spanTimeText } from "../lib/eventSpan";
import { parseSender } from "../lib/gmail";
import { pullBlockedSendersIfDue } from "../lib/blockedSenders";
import { useTripCover } from "../hooks/useTripCover";
import { getScheduleCategory } from "../lib/scheduleCategories";
import { PersonTags } from "../components/calendar/PersonTags";
import { usePayPeriodBudget } from "../hooks/usePayPeriodBudget";
import { useHubMotion } from "../hooks/useHubMotion";
import { toggleTaskCompletion } from "../components/tasks/TaskList";
import { haptic } from "../lib/haptics";
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
import { useHiddenFeatures } from "../hooks/useHiddenFeatures";
import { aheadDates, aheadDayLabel, buildConcerns, homeStatusLine, tripCardMode } from "../lib/homeLayout";

/** 1日に出す予定・タスクの数。残りは件数だけ出し、中身は予定の画面で見る。 */
const EVENTS_PER_DAY = 4;
const TASKS_PER_DAY = 3;
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

function minutesUntil(time: string | undefined, now: Date): number | null {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  const minutes = Math.ceil((target.getTime() - now.getTime()) / 60_000);
  return minutes < 0 ? null : minutes;
}

function formatCountdown(minutes: number): string {
  if (minutes === 0) return "まもなく";
  if (minutes < 60) return `あと${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `あと${hours}時間${rest ? `${rest}分` : ""}`;
}

/** 何日かにまたがる予定の開始時刻は、初日にしか意味がない。2日目以降も同じ時刻で扱うと、
 * 泊まっている最中の宿泊が「10:00に始まる次の予定」として毎朝出てくる。 */
function timeOn(event: CalendarEvent, date: string): string | undefined {
  return event.allDay || spanDayIndex(event, date) !== 1 ? undefined : event.startTime;
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99") ||
      a.createdAt - b.createdAt,
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
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

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
  // 「誰の予定か」の名前と色。付けた印はホームにも出す(付けたのに出ないと、付いているのか分からないため)。
  const eventPeople = useLiveQuery(() => db.eventPeople.toArray(), []) ?? [];

  const todayEvents = (eventsResult ?? []).filter((event) => occursOn(event, today));
  const todayOpenTasks = tasks.filter((task) => task.dueDate === today && !task.completed).length;
  const statusLine = homeStatusLine(eventsResult ? todayEvents.length : undefined, tasksResult ? todayOpenTasks : undefined);
  const nextEvent = [...todayEvents]
    .sort((a, b) => (timeOn(a, today) ?? "").localeCompare(timeOn(b, today) ?? ""))
    .find((event) => !timeOn(event, today) || minutesUntil(timeOn(event, today), now) !== null);

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
  const tripDays = featuredTrip ? differenceInCalendarDays(parseISO(featuredTrip.startDate), now) : null;
  const tripMode = tripCardMode(featuredTrip, today);
  const tripFacts = useLiveQuery(async () => {
    const id = featuredTrip?.id;
    if (!id) return null;
    const [packing, expenses] = await Promise.all([
      db.tripPackingItems.where("tripId").equals(id).toArray(),
      db.tripExpenses.where("tripId").equals(id).toArray(),
    ]);
    return {
      packed: packing.filter((item) => item.checked).length,
      packingTotal: packing.length,
      spent: expenses.reduce((sum, row) => sum + row.amount, 0),
    };
  }, [featuredTrip?.id]);
  const tripWhen = featuredTrip
    ? tripDays === null || tripDays < 0
      ? featuredTrip.status === "ongoing"
        ? "旅行中"
        : `${formatDisplayDate(featuredTrip.startDate)} 〜 ${formatDisplayDate(featuredTrip.endDate)}`
      : tripDays === 0
        ? "本日出発"
        : `あと ${tripDays} 日`
    : "";

  return (
    <div className={`warm-home lh-home${hide.money ? " lh-home--no-money" : ""}${hide.trips ? " lh-home--no-trips" : ""}`} ref={motionRef}>
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

      {/* 3. 今日と、この先(今日・明日・明後日)。予定の無い日は薄い1行。 */}
      {!hide.schedule && (
        <section className="lh-section lh-section--ahead" data-reveal="3">
          <SectionHead title="今日と、この先" to="/schedule?view=calendar" />
          <div className="warm-card lh-ahead">
            <div className="lh-ahead__days">
              {dates.map((date) => {
                const dayEvents = (eventsResult ?? [])
                  .filter((event) => occursOn(event, date))
                  .sort((a, b) => (timeOn(a, date) ?? "").localeCompare(timeOn(b, date) ?? ""));
                const dayTasks = sortTasks(tasks.filter((task) => task.dueDate === date));
                const shownEvents = dayEvents.slice(0, EVENTS_PER_DAY);
                const shownTasks = dayTasks.slice(0, TASKS_PER_DAY);
                const rest = dayEvents.length - shownEvents.length + (dayTasks.length - shownTasks.length);
                const label = aheadDayLabel(date, today);
                const isToday = date === today;
                return (
                  <div key={date} className={`lh-ahead__day${isToday ? " is-today" : ""}`}>
                    <p className="lh-ahead__date">
                      <b>{label}</b>
                      <span>{formatShortDate(date)}</span>
                    </p>
                    {shownEvents.length === 0 && shownTasks.length === 0 ? (
                      <p className="lh-ahead__none">{eventsResult && tasksResult ? "予定なし" : " "}</p>
                    ) : (
                      <div className="lh-ahead__rows">
                        {shownEvents.map((event) => {
                          const category = getScheduleCategory(event.category);
                          const time = timeOn(event, date);
                          const past = isToday && !event.allDay && Boolean(time) && minutesUntil(time, now) === null;
                          const minutes = isToday && event.id === nextEvent?.id ? minutesUntil(time, now) : null;
                          return (
                            <Link key={`${event.id}-${date}`} to="/schedule?view=calendar" className={`lh-row lh-ahead__row${past ? " is-past" : ""}`}>
                              <span className={`lh-row__icon lh-tone--${category.tone}`} aria-hidden="true">
                                <CalendarDays size={16} strokeWidth={2} />
                              </span>
                              <span className="lh-row__copy">
                                <strong>{event.title}</strong>
                                <small>
                                  <span className="lh-row__time">{spanTimeText(event, date)}</span>
                                  {event.location || category.label}
                                </small>
                                <PersonTags event={event} people={eventPeople} compact />
                              </span>
                              {minutes !== null && minutes !== undefined ? (
                                <span className="warm-list__meta">{formatCountdown(minutes)}</span>
                              ) : (
                                <ChevronRight className="lh-row__chev" size={16} aria-hidden="true" />
                              )}
                            </Link>
                          );
                        })}
                        {shownTasks.map((task) => (
                          <div key={task.id} className={`lh-row lh-ahead__row${task.completed ? " is-done" : ""}`}>
                            <button
                              type="button"
                              className="warm-check"
                              onClick={() => {
                                // 完了にした時だけ、Android では短く振動させる(第4弾 A-6)。
                                if (!task.completed) haptic("success");
                                void toggleTaskCompletion(task);
                              }}
                              aria-label={`${task.title}の完了を切り替え`}
                              aria-pressed={task.completed}
                            >
                              <Check size={12} strokeWidth={3.2} />
                            </button>
                            <Link to="/schedule?view=list" className="lh-row__copy">
                              <strong>{task.title}</strong>
                            </Link>
                            {task.dueTime && <span className="warm-list__meta">{task.dueTime}</span>}
                          </div>
                        ))}
                        {rest > 0 && (
                          <Link to="/schedule?view=calendar" className="lh-ahead__more">
                            ほか {rest} 件
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="lh-ahead__foot">
              <button type="button" className="lh-add-pill" onClick={() => openQuickAdd("event")}>
                <Plus size={14} aria-hidden="true" />
                予定
              </button>
              <button type="button" className="lh-add-pill" onClick={() => openQuickAdd("task")}>
                <Plus size={14} aria-hidden="true" />
                タスク
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 4. 次の旅行。30日以内か旅行中は写真のカード、それ以外は1行の帯。 */}
      {!hide.trips && tripsResult === undefined && (
        <section className="lh-section lh-section--trip is-band" aria-hidden="true">
          <div className="warm-card lh-trip-band lh-trip-band--loading" />
        </section>
      )}
      {!hide.trips && tripsResult !== undefined && (
        <section className={`lh-section lh-section--trip${tripMode === "band" ? " is-band" : ""}`} data-reveal="4">
          {tripMode === "big" && featuredTrip ? (
            <>
              <SectionHead title="次の旅行" to="/trips" />
              <Link to={featuredTrip.id ? `/trips/${featuredTrip.id}` : "/trips"} className="warm-trip">
                <div className="warm-trip__photo" style={{ backgroundImage: `url('${tripCover.url}')` }} aria-hidden="true" />
                <div className="warm-trip__veil" aria-hidden="true" />
                <span className="warm-trip__kicker">
                  <Plane size={13} strokeWidth={2.2} />
                  {TRIP_STATUS_LABEL[featuredTrip.status]}
                </span>
                <p className="warm-trip__place">{featuredTrip.name || featuredTrip.destination}</p>
                <p className="warm-trip__when">
                  {tripWhen}
                  {tripFacts && (
                    <>
                      <span aria-hidden="true">・</span>持ち物 {tripFacts.packed}/{tripFacts.packingTotal}
                      <span aria-hidden="true">・</span>使った額 ¥{Math.round(tripFacts.spent).toLocaleString()}
                    </>
                  )}
                </p>
              </Link>
            </>
          ) : (
            <Link to={featuredTrip?.id ? `/trips/${featuredTrip.id}` : "/trips"} className="warm-card lh-trip-band">
              <span className="lh-row__icon lh-tone--accent" aria-hidden="true">
                <Plane size={16} strokeWidth={2} />
              </span>
              <span className="lh-row__copy">
                <strong>{featuredTrip ? featuredTrip.name || featuredTrip.destination : "次はどこへ"}</strong>
                <small>{featuredTrip ? tripWhen : "旅の計画を立てましょう"}</small>
              </span>
              <ChevronRight className="lh-row__chev" size={16} aria-hidden="true" />
            </Link>
          )}
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
