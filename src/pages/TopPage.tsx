import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { ArrowRight, CalendarDays, CheckSquare, Check, ChevronRight, Mail, Plane, Plus } from "lucide-react";
import { db } from "../db/schema";
import type { CalendarEvent } from "../types";
import { formatDisplayDate, formatGmailTimestamp, toDateStr, todayStr } from "../lib/date";
import { occursOn, spanDayIndex, spanTimeText } from "../lib/eventSpan";
import { avatarColor, avatarInitial, isUnhandledEmail, parseSender } from "../lib/gmail";
import { pullBlockedSenders } from "../lib/blockedSenders";
import { useTripCover } from "../hooks/useTripCover";
import { getScheduleCategory } from "../lib/scheduleCategories";
import { getHolidayMapForYears } from "../lib/holidays";
import { groupWeekAhead, hasWeekAheadItems, weekAheadDates } from "../lib/weekAhead";
import { PersonTags } from "../components/calendar/PersonTags";
import { usePayPeriodBudget } from "../hooks/usePayPeriodBudget";
import { useHubMotion } from "../hooks/useHubMotion";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { toggleTaskCompletion } from "../components/tasks/TaskList";
import { UsageAlertCard } from "../components/review/UsageAlertCard";
import { useUsageAlerts } from "../hooks/useFeatureUsage";
import { useReplyWaiting } from "../hooks/useReplyWaiting";
import { useGoogleCalendarAutoSync } from "../hooks/useGoogleCalendarAutoSync";
import { BriefingCard } from "../components/home/BriefingCard";
import { PageFab } from "../components/ui/PageFab";
import { CountingAmount } from "../components/ui/CountingAmount";
import { openAddChooser } from "../components/layout/AddChooser";

const EVENT_PREVIEW_LIMIT = 3;
const TASK_PREVIEW_LIMIT = 3;
const GMAIL_PREVIEW_LIMIT = 3;
/** ホーム下段の「今週これから」。PC幅だけに出す(スマホは今のままでいい、という指示)。
 *  明日から7日ぶんを1列ずつ並べ、1日に出すのは3件まで。 */
const WEEK_AHEAD_DAYS = 7;
const WEEK_AHEAD_PER_DAY = 3;
const TRIP_STATUS_LABEL: Record<string, string> = { ongoing: "旅行中", planning: "計画中", completed: "完了済み" };

/** ヒーローの写真。時間帯ごとに、光の向きが合う暖色の室内カットを1枚ずつ。
 *  素材は既存の public/backgrounds（旧デザインで全画面の地に敷いていたもの）。 */
const HERO_PHOTO = [
  { until: 10, src: "/backgrounds/morning-window-living-v5.jpg", quote: "静かに、今日を始める。" },
  { until: 16, src: "/backgrounds/day-sunlit-villa-v5.jpg", quote: "急がず、ひとつずつ。" },
  { until: 20, src: "/backgrounds/evening-warm-atrium-v5.jpg", quote: "今日の分は、ここまで。" },
  { until: 24, src: "/backgrounds/night-ambient-lounge-v5.jpg", quote: "明日のために、休む時間を。" },
] as const;

function heroFor(hour: number) {
  return HERO_PHOTO.find((entry) => hour < entry.until) ?? HERO_PHOTO[0];
}

/** 区切りの見出し。2026-10-12 の並べ替えで、見出しはカードの外（参考にしたアプリの形）に出した。 */
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

export default function TopPage() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const motionRef = useHubMotion<HTMLDivElement>();

  const today = todayStr();
  // 何日かにまたがる予定(宿泊など)は初日の date しか索引に載らないので、date の索引で
  // 今日ぶんだけを引くと2日目以降がTOPから消える。全部見てから絞る(src/lib/eventSpan.ts)。
  const eventsResult = useLiveQuery(
    () => db.calendarEvents.filter((event) => occursOn(event, today)).toArray(),
    [today],
  );
  // 何日かにまたがる予定の開始時刻は、初日にしか意味がない。2日目以降も同じ時刻で
  // 扱うと、泊まっている最中の宿泊が「10:00に始まる次の予定」として毎朝出てくる。
  const startsToday = (event: CalendarEvent) => spanDayIndex(event, today) === 1;
  const timeToday = (event: CalendarEvent) => (event.allDay || !startsToday(event) ? undefined : event.startTime);
  const allTodayEvents = [...(eventsResult ?? [])].sort((a, b) =>
    (timeToday(a) ?? "").localeCompare(timeToday(b) ?? ""),
  );
  const previewEvents = allTodayEvents.slice(0, EVENT_PREVIEW_LIMIT);
  const nextEvent = allTodayEvents.find(
    (event) => !timeToday(event) || minutesUntil(timeToday(event), now) !== null,
  );
  const nextEventMinutes = nextEvent ? minutesUntil(timeToday(nextEvent), now) : null;
  // 「誰の予定か」の名前と色。付けた印はホームの「次の予定」にも出す
  // (付けたのに一覧に出ないと、付いているのか分からないため)。
  const eventPeople = useLiveQuery(() => db.eventPeople.toArray(), []) ?? [];
  const tasksResult = useLiveQuery(() => db.tasks.where("dueDate").equals(today).toArray(), [today]);
  const todayTasks = (tasksResult ?? []).filter((task) => !task.parentTaskId);
  const doneCount = todayTasks.filter((task) => task.completed).length;
  const openCount = todayTasks.length - doneCount;
  const sortedTasks = [...todayTasks].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99") ||
      a.createdAt - b.createdAt,
  );
  const previewTasks = sortedTasks.slice(0, TASK_PREVIEW_LIMIT);

  const { data: budget } = usePayPeriodBudget();
  // 給与がまだ無い時の「今月のお金」。前は「¥—」と案内の1行だけで、ホームでいちばん大きな
  // 面が空いていた(UI/UX 調査メモ A-4)ので、給与が無くても分かる今月の支出を出す。
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
  // 使われなくなった機能のお知らせ。ある月だけ、上段と4分割のカードの間に1枚出す。
  const usageAlerts = useUsageAlerts();
  // 「今日のまとめ」に出す返信待ち(src/lib/replyWaiting.ts)。
  const replyWaiting = useReplyWaiting();
  // Googleカレンダーの取り込みを入にしてあれば、開いた時に取り込む(10分に1回まで)。
  useGoogleCalendarAutoSync();

  // 「今週これから」— 明日から7日ぶん。PC幅でしか出さないので、スマホでは
  // 予定の全件走査そのものを走らせない(useIsDesktop で問い合わせごと止める)。
  const isDesktop = useIsDesktop();
  const weekDates = useMemo(() => (isDesktop ? weekAheadDates(today, WEEK_AHEAD_DAYS) : []), [today, isDesktop]);
  // 何日かにまたがる予定・繰り返しの予定は date の索引では引けないので、
  // 上の「今日の予定」と同じく全部見てから絞る(src/lib/eventSpan.ts)。
  const weekEvents = useLiveQuery(
    () =>
      weekDates.length === 0
        ? Promise.resolve<CalendarEvent[]>([])
        : db.calendarEvents.filter((event) => weekDates.some((date) => occursOn(event, date))).toArray(),
    [isDesktop, today],
  );
  const weekDays = useMemo(() => groupWeekAhead(weekEvents ?? [], weekDates), [weekEvents, weekDates]);
  const weekHolidays = useMemo(
    () => (weekDates.length === 0 ? new Map<string, string>() : getHolidayMapForYears([...new Set(weekDates.map((d) => Number(d.slice(0, 4))))])),
    [weekDates],
  );

  // ブロック中の送信者リストは端末ごとのローカル(db.blockedSenders)で、汎用同期エンジンの
  // 対象外。取り込みは受信トレイ(/gmail)とメール画面でしか走っていなかったので、PCで
  // ブロックした送信者がスマホのTOPには出続けていた(受信トレイを一度開くまで消えない)。
  // TOPは受信トレイを開かずに眺める画面なので、ここでも取り込む(src/lib/blockedSenders.ts)。
  const gmailAccounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);
  useEffect(() => {
    for (const account of gmailAccounts ?? []) {
      if (account.id) void pullBlockedSenders(account.id, account.email);
    }
  }, [gmailAccounts]);

  // アカウントはこの中でも読み直す — 上のgmailAccountsは読み込み中がundefinedで、
  // それを使うと一瞬「未接続」の表示が出てしまう。
  const gmailPreview = useLiveQuery(async () => {
    const accounts = await db.gmailAccounts.toArray();
    if (accounts.length === 0) return { connected: false, emails: [], total: 0, importantUnread: 0 };
    const [blocked, allEmails] = await Promise.all([
      db.blockedSenders.toArray(),
      db.syncedEmails.orderBy("receivedAt").reverse().toArray(),
    ]);
    const blockedSet = new Set(blocked.map((item) => `${item.accountId}:${item.email}`));
    // 受信トレイの「すべて」タブとまったく同じ絞り込み — ブロック中の送信者を外し、
    // 既読にしたものと返信を送ったものも外して、まだ手を付けていない直近だけを出す
    // (isUnhandledEmailはGmailInboxと共有。TOPだけ独自に「全部の直近」を出していた
    // 頃は、受信トレイでは片付いているメールがTOPには残り続けていた)。
    const visible = allEmails.filter(
      (email) =>
        !blockedSet.has(`${email.accountId}:${parseSender(email.from).email.toLowerCase()}`) &&
        isUnhandledEmail(email),
    );
    // 「今日のまとめ」の重要な未読。重要を付けた・まだ読んでいない・返信していないもの
    // (朝の通知 netlify/functions/sendMorningBriefing.ts も同じ数え方)。
    const importantUnread = allEmails.filter(
      (email) =>
        !blockedSet.has(`${email.accountId}:${parseSender(email.from).email.toLowerCase()}`) &&
        email.importantAt &&
        !email.readAt &&
        email.status !== "sent",
    ).length;
    return { connected: true, emails: visible.slice(0, GMAIL_PREVIEW_LIMIT), total: visible.length, importantUnread };
  }, []);

  const tripsResult = useLiveQuery(() => db.trips.toArray(), []);
  const featuredTrip =
    tripsResult?.find((trip) => trip.status === "ongoing") ??
    [...(tripsResult ?? [])]
      .filter((trip) => trip.status === "planning")
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const tripCover = useTripCover(featuredTrip?.name ?? "", featuredTrip?.destination ?? "");

  const tripDays = featuredTrip ? differenceInCalendarDays(parseISO(featuredTrip.startDate), now) : null;

  const hour = now.getHours();
  const hero = heroFor(hour);

  // 2026-10-12: 並べ方を変えた（参考: サブスクBOX）。中身・リンク・ボタンの働きは前と同じ。
  //  - いちばん上は写真の表紙（日付・時刻・ひとこと）に、黒い「今月のお金」が重なる形
  //  - 見出しはカードの外に出し、カードの中は区切り線つきの行の一覧にする
  //  - DOM の順番はスマホの並び順。PC の並びは home-teal.css のグリッドが決める
  return (
    <div className="warm-home lh-home" ref={motionRef}>
      <header className="lh-cover" data-reveal="0">
        <div className="lh-cover__photo" style={{ backgroundImage: `url('${hero.src}')` }} aria-hidden="true" />
        <div className="lh-cover__veil" aria-hidden="true" />
        <div className="lh-cover__copy">
          <h1 className="lh-cover__date">
            <time dateTime={today}>{formatDisplayDate(today)}</time>
          </h1>
          <p className="lh-cover__quote">{hero.quote}</p>
        </div>
        <p className="lh-cover__clock">
          {/* 24時間の表記(2026-10-12、UI/UX 調査メモ C-4)。ここだけ「5:34 PM」と英語だった。 */}
          <time dateTime={format(now, "yyyy-MM-dd'T'HH:mm")}>{format(now, "H:mm")}</time>
        </p>
      </header>

      {budget ? (
        <Link to="/records/expense" className="warm-card lh-money" data-reveal="1">
          <span className="lh-money__label">今月のお金</span>
          <p className={`warm-amount ${budget.remaining < 0 ? "is-negative" : ""}`}>
            <small>¥</small>
            {/* 支出を記録すると、減った額が「−¥1,280」と浮かんでから、前の残りから数え下がる
                (UI/UX 調査メモ 第4弾 A-5)。給料日で期間が替わった時は動かさない。 */}
            <CountingAmount value={budget.remaining} resetKey={toDateStr(budget.period.periodStart)} showDelta />
          </p>
          <dl className="lh-money__stats">
            <div>
              <dt>1日あたり使える</dt>
              <dd>¥{Math.round(Math.max(0, budget.perDayUsable)).toLocaleString()}</dd>
            </div>
            <div>
              <dt>使った額</dt>
              <dd>
                ¥<CountingAmount value={budget.actualSpending} resetKey={toDateStr(budget.period.periodStart)} />
              </dd>
            </div>
            <div>
              <dt>給料日まで</dt>
              <dd>{budget.period.daysUntilNextPayday}日</dd>
            </div>
          </dl>
          <span className="warm-card__foot">
            詳細をチェック <ArrowRight size={14} />
          </span>
        </Link>
      ) : (
        // 給与がまだ無い時。中にリンクが2つあるので、カードそのものはリンクにしない。
        <div className="warm-card lh-money is-unset" data-reveal="1">
          <span className="lh-money__label">今月の支出</span>
          <p className="warm-amount">
            <small>¥</small>
            {/* ホームの「＋」で支出を入れると、足した額が「+¥1,280」と浮かんでから合計に入り、
                合計は前の値から数え上がる(UI/UX 調査メモ 第4弾 A-5)。月が替わった時は動かさない。 */}
            <CountingAmount value={monthSpending?.total} resetKey={monthStart} showDelta />
          </p>
          <dl className="lh-money__stats">
            <div>
              <dt>記録した数</dt>
              <dd>{monthSpending?.count ?? 0}件</dd>
            </div>
            <div>
              <dt>今日</dt>
              <dd>¥{(monthSpending?.today ?? 0).toLocaleString()}</dd>
            </div>
            <div>
              <dt>さいごの支出</dt>
              <dd>{monthSpending?.latest ?? "まだなし"}</dd>
            </div>
          </dl>
          <p className="warm-amount__note">給与を入れると、給料日まで1日いくら使えるかも出ます</p>
          <div className="lh-money__actions">
            <Link to="/records/expense?new=salary" className="lh-money__cta">
              給与を登録する
            </Link>
            <Link to="/records/expense?tab=history" className="warm-card__foot">
              支出を見る <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}

      {/* 今日のまとめ(2026-09-16)。予定・重要な未読・返信待ちを、画面を回らずに1枚で。 */}
      <BriefingCard
        eventCount={eventsResult ? allTodayEvents.length : undefined}
        nextEvent={nextEvent ? { title: nextEvent.title, time: timeToday(nextEvent) } : undefined}
        gmail={gmailPreview}
        waiting={replyWaiting}
      />

      <section className="lh-section lh-section--events" data-reveal="3">
        <SectionHead title="次の予定" to="/schedule?view=calendar" />
        <div className="warm-card lh-group">
          {previewEvents.length > 0 ? (
            previewEvents.map((event) => {
              const category = getScheduleCategory(event.category);
              const time = timeToday(event);
              const past = !event.allDay && Boolean(time) && minutesUntil(time, now) === null;
              const countdown =
                event.id === nextEvent?.id && nextEventMinutes !== null ? formatCountdown(nextEventMinutes) : null;
              return (
                <Link key={event.id} to="/schedule?view=calendar" className={`lh-row ${past ? "is-past" : ""}`}>
                  <span className={`lh-row__icon lh-tone--${category.tone}`} aria-hidden="true">
                    <CalendarDays size={18} strokeWidth={2} />
                  </span>
                  <span className="lh-row__copy">
                    <strong>{event.title}</strong>
                    <small>
                      <span className="lh-row__time">{spanTimeText(event, today)}</span>
                      {event.location || category.label}
                    </small>
                    <PersonTags event={event} people={eventPeople} compact />
                  </span>
                  {countdown ? (
                    <span className="warm-list__meta">{countdown}</span>
                  ) : (
                    <ChevronRight className="lh-row__chev" size={16} aria-hidden="true" />
                  )}
                </Link>
              );
            })
          ) : (
            <div className="warm-empty">
              <span className="warm-empty__icon">
                <CalendarDays size={18} />
              </span>
              <div className="min-w-0">
                <strong>予定はありません</strong>
                <p>カレンダーから追加できます</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="lh-section lh-section--tasks" data-reveal="4">
        <SectionHead
          title="今日のタスク"
          trailing={
            todayTasks.length > 0 ? (
              <span className="warm-card__badge">{doneCount}/{todayTasks.length} 完了</span>
            ) : undefined
          }
        />
        <div className="warm-card lh-group">
          {previewTasks.length > 0 ? (
            previewTasks.map((task) => (
              <div key={task.id} className={`lh-row ${task.completed ? "is-done" : ""}`}>
                <button
                  type="button"
                  className="warm-check"
                  onClick={() => toggleTaskCompletion(task)}
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
            ))
          ) : (
            <div className="warm-empty">
              <span className="warm-empty__icon">
                <CheckSquare size={18} />
              </span>
              <div className="min-w-0">
                <strong>今日のタスクはありません</strong>
                <p>一覧から追加できます</p>
              </div>
            </div>
          )}
          <Link to="/schedule?view=list" className="lh-row lh-row--foot">
            <span className="lh-row__copy">
              <strong>{openCount > 0 ? `すべてのタスクを見る（あと ${openCount} 件）` : "すべてのタスクを見る"}</strong>
            </span>
            <ChevronRight className="lh-row__chev" size={16} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="lh-section lh-section--trip" data-reveal="2">
        <SectionHead title="旅行" />
        <Link to="/trips" className="warm-trip">
          <div
            className="warm-trip__photo"
            style={featuredTrip ? { backgroundImage: `url('${tripCover.url}')` } : undefined}
            aria-hidden="true"
          />
          <div className="warm-trip__veil" aria-hidden="true" />
          <span className="warm-trip__kicker">
            <Plane size={13} strokeWidth={2.2} />
            {featuredTrip ? TRIP_STATUS_LABEL[featuredTrip.status] : "次の旅"}
          </span>
          <p className="warm-trip__place">{featuredTrip ? featuredTrip.destination || featuredTrip.name : "次はどこへ"}</p>
          <p className="warm-trip__when">
            {featuredTrip
              ? `${formatDisplayDate(featuredTrip.startDate)} 〜 ${formatDisplayDate(featuredTrip.endDate)}${
                  tripDays !== null && tripDays >= 0 ? `（${tripDays === 0 ? "本日出発" : `あと ${tripDays} 日`}）` : ""
                }`
              : "旅の計画を立てましょう"}
          </p>
        </Link>
      </section>

      <section className="lh-section lh-section--gmail" data-reveal="5">
        <SectionHead
          title="Gmail"
          to={gmailPreview?.total ? undefined : "/gmail"}
          trailing={
            gmailPreview?.total ? <span className="warm-card__badge">{gmailPreview.total}件の未処理</span> : undefined
          }
        />
        <div className="warm-card lh-group">
          {gmailPreview?.emails.length ? (
            gmailPreview.emails.map((email) => {
              const sender = parseSender(email.from);
              return (
                <Link key={email.id} to={`/gmail/mail/${email.id}`} className="lh-row">
                  <span className={`warm-avatar lh-row__icon ${avatarColor(sender.email)}`}>{avatarInitial(sender.name)}</span>
                  <span className="lh-row__copy">
                    <strong>{sender.name}</strong>
                    <small>{email.subject}</small>
                  </span>
                  <span className="lh-row__aside">{formatGmailTimestamp(email.receivedAt)}</span>
                </Link>
              );
            })
          ) : (
            <div className="warm-empty">
              <span className="warm-empty__icon">
                <Mail size={18} />
              </span>
              <div className="min-w-0">
                <strong>{gmailPreview?.connected ? "未処理のメールはありません" : "Gmailを接続"}</strong>
                <p>{gmailPreview?.connected ? "既読・返信済みは受信トレイで見られます" : "最新メールと返信案をここで確認"}</p>
              </div>
            </div>
          )}
          <Link to="/gmail" className="lh-row lh-row--foot">
            <span className="lh-row__copy">
              <strong>{gmailPreview?.connected ? "すべてのメールを見る" : "接続画面を開く"}</strong>
            </span>
            <ChevronRight className="lh-row__chev" size={16} aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* 今週これから(PC幅だけ)。上の「次の予定」は今日ぶんしか出さないので、
          ここが明日から先を受け持つ。1件も無い週はカードごと出さない — 空の枠が
          7列並ぶだけになり、かえって画面が寂しくなるため。 */}
      {isDesktop && hasWeekAheadItems(weekDays) && (
        <section className="lh-section lh-section--week" data-reveal="6">
          <SectionHead title="今週これから" to="/schedule?view=calendar" />
          <div className="warm-card warm-week">
            <div className="warm-week__grid">
              {weekDays.map((day) => {
                const dayDate = parseISO(day.date);
                const weekday = dayDate.getDay();
                const holiday = weekHolidays.get(day.date);
                const shown = day.items.slice(0, WEEK_AHEAD_PER_DAY);
                const rest = day.items.length - shown.length;
                const tone = holiday || weekday === 0 ? "is-sun" : weekday === 6 ? "is-sat" : "";
                return (
                  <div key={day.date} className={`warm-week__day ${shown.length === 0 ? "is-quiet" : ""}`}>
                    <p className={`warm-week__date ${tone}`}>
                      <b>{format(dayDate, "M/d")}</b>
                      <span>{format(dayDate, "EEE", { locale: ja })}</span>
                    </p>
                    {holiday && <p className="warm-week__holiday">{holiday}</p>}
                    {shown.length > 0 ? (
                      <ul className="warm-week__items">
                        {shown.map((event) => (
                          <li key={`${event.id}-${day.date}`} className="warm-week__item">
                            <i
                              className={`warm-dot warm-dot--${getScheduleCategory(event.category).tone}`}
                              aria-hidden="true"
                            />
                            <span className="warm-week__copy">
                              <strong>{event.title}</strong>
                              <small>{spanTimeText(event, day.date)}</small>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="warm-week__none">予定なし</p>
                    )}
                    {rest > 0 && <p className="warm-week__more">ほか {rest} 件</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 使われなくなった機能のお知らせ。前は「今日のまとめ」のすぐ下(次の予定より上)に
          カード1枚で出ていたが、毎日の行動とは関係が薄いので、いちばん下の1行に縮めた
          (UI/UX 調査メモ A-5)。 */}
      <UsageAlertCard alerts={usageAlerts.alerts} onDismiss={usageAlerts.dismiss} compact />

      {/* 追加の入口(UI/UX 調査メモ A-3)。ホームは何を足すか決まらないので、選ぶシートを開く。 */}
      <PageFab onClick={openAddChooser} label="追加する">
        <Plus size={24} />
      </PageFab>
    </div>
  );
}
