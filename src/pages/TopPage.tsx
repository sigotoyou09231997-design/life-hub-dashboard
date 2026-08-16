import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronRight,
  Circle,
  Mail,
  MapPin,
  NotebookPen,
  Plane,
  Wallet,
} from "lucide-react";
import { db } from "../db/schema";
import { formatDisplayDate, formatGmailTimestamp, todayStr } from "../lib/date";
import { avatarColor, avatarInitial, parseSender } from "../lib/gmail";
import { NOTE_TYPE_DEFS, getNoteType } from "../lib/noteTypes";
import { getScheduleCategory } from "../lib/scheduleCategories";
import { usePayPeriodBudget } from "../hooks/usePayPeriodBudget";
import { toggleTaskCompletion } from "../components/tasks/TaskList";

const EVENT_PREVIEW_LIMIT = 2;
const TASK_PREVIEW_LIMIT = 3;
const GMAIL_PREVIEW_LIMIT = 3;
const TRIP_STATUS_LABEL: Record<string, string> = { ongoing: "旅行中", planning: "計画中", completed: "完了済み" };

function ModuleHeading({ icon: Icon, eyebrow, action }: { icon: typeof CalendarDays; eyebrow: string; action?: ReactNode }) {
  return (
    <div className="home-module__heading">
      <div className="home-module__eyebrow"><Icon size={15} strokeWidth={1.75} /><span>{eyebrow}</span></div>
      {action}
    </div>
  );
}

function getGreeting(hour: number): string {
  if (hour < 5) return "まだ静かな時間です";
  if (hour < 11) return "おはようございます";
  if (hour < 17) return "今日もおつかれさまです";
  return "こんばんは";
}

function minutesUntil(time: string | undefined, now: Date): string | null {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  const minutes = Math.ceil((target.getTime() - now.getTime()) / 60_000);
  if (minutes < 0) return null;
  if (minutes < 60) return minutes === 0 ? "まもなく" : `あと${minutes}分`;
  return `あと${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ""}`;
}

function timelinePosition(time: string | undefined): number | null {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return Math.max(0, Math.min(100, (((hour + minute / 60) - 6) / 18) * 100));
}

export default function TopPage() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const today = todayStr();
  const eventsResult = useLiveQuery(() => db.calendarEvents.where("date").equals(today).toArray(), [today]);
  const allTodayEvents = [...(eventsResult ?? [])].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  const todayEvents = allTodayEvents.slice(0, EVENT_PREVIEW_LIMIT);
  const nextTimedEvent = allTodayEvents.find((event) => !event.startTime || minutesUntil(event.startTime, now));
  const nextEventLabel = nextTimedEvent?.allDay ? "終日" : minutesUntil(nextTimedEvent?.startTime, now);

  const tasksResult = useLiveQuery(() => db.tasks.where("dueDate").equals(today).toArray(), [today]);
  const todayTasks = (tasksResult ?? []).filter((task) => !task.parentTaskId);
  const doneCount = todayTasks.filter((task) => task.completed).length;
  const progress = todayTasks.length ? Math.round((doneCount / todayTasks.length) * 100) : 0;
  const previewTasks = [...todayTasks].sort((a, b) => Number(a.completed) - Number(b.completed) || a.createdAt - b.createdAt).slice(0, TASK_PREVIEW_LIMIT);
  const { data: budget } = usePayPeriodBudget();
  const financeBars = budget
    ? [
        { label: "収入", value: budget.period.salaryAmount },
        { label: "固定費後", value: budget.period.salaryAmount - budget.totalFixedCosts },
        { label: "現在", value: budget.remaining },
      ]
    : [
        { label: "収入", value: 72 },
        { label: "固定費後", value: 54 },
        { label: "現在", value: 38 },
      ];
  const financeBarMax = Math.max(1, ...financeBars.map((item) => Math.max(0, item.value)));

  const gmailPreview = useLiveQuery(async () => {
    const accounts = await db.gmailAccounts.toArray();
    if (accounts.length === 0) return { connected: false, emails: [] };
    const [blocked, allEmails] = await Promise.all([
      db.blockedSenders.toArray(),
      db.syncedEmails.orderBy("receivedAt").reverse().toArray(),
    ]);
    const blockedSet = new Set(blocked.map((item) => `${item.accountId}:${item.email}`));
    const emails = allEmails
      .filter((email) => !blockedSet.has(`${email.accountId}:${parseSender(email.from).email.toLowerCase()}`))
      .slice(0, GMAIL_PREVIEW_LIMIT);
    return { connected: true, emails };
  }, []);

  const notesResult = useLiveQuery(() => db.notes.toArray(), []);
  const noteSummaries = NOTE_TYPE_DEFS.map((definition) => {
    const items = (notesResult ?? []).filter((note) => getNoteType(note) === definition.value);
    const latest = [...items].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))[0];
    return { definition, count: items.length, latestTitle: latest?.title };
  });

  const tripsResult = useLiveQuery(() => db.trips.toArray(), []);
  const featuredTrip =
    tripsResult?.find((trip) => trip.status === "ongoing") ??
    [...(tripsResult ?? [])].filter((trip) => trip.status === "planning").sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const tripDays = featuredTrip ? differenceInCalendarDays(parseISO(featuredTrip.startDate), now) : null;

  return (
    <div className="home-os micro-contrast">
      <section className="home-status" aria-label="今日のステータス">
        <div>
          <p className="home-status__label">Personal control center</p>
          <div className="home-status__clock-row">
            <p className="home-status__clock">{format(now, "H:mm")}</p>
            <span className="home-status__live"><i />LIVE</span>
          </div>
          <p className="home-status__date">{format(now, "yyyy年M月d日 EEEE", { locale: ja })}</p>
        </div>
        <div className="home-status__message">
          <p>{getGreeting(now.getHours())}</p>
          <span>予定も、暮らしも、ここから。</span>
        </div>
      </section>

      <div className="home-bento">
        <article className={`home-module home-module--schedule home-module--reflect ${todayEvents.length === 0 ? "is-empty" : "has-data"}`}>
          <ModuleHeading icon={CalendarDays} eyebrow="今日の予定" action={<span className="home-module__count">{allTodayEvents.length} events</span>} />
          <div className="home-schedule__summary">
            <div className="home-date-tile"><strong>{format(now, "d")}</strong><span>{format(now, "EEE", { locale: ja })}</span></div>
            <div className="min-w-0">
              <p className="home-module__title">{nextTimedEvent?.title ?? "静かな一日です"}</p>
              <p className="home-module__meta">{nextTimedEvent ? `${nextTimedEvent.startTime ?? "終日"}${nextEventLabel ? ` · ${nextEventLabel}` : ""}` : "新しい予定はカレンダーから追加できます"}</p>
            </div>
          </div>
          {todayEvents.length > 0 && (
            <div className="home-schedule__list">
              {todayEvents.map((event) => {
                const category = getScheduleCategory(event.category);
                return <Link key={event.id} to="/schedule?view=calendar" className="home-schedule__row"><span>{event.startTime ?? "終日"}</span><i className={`home-category-dot home-category-dot--${category.tone}`} /><strong>{event.title}</strong><small>{category.label}</small></Link>;
              })}
            </div>
          )}
          <div className="home-timeline" aria-label="今日の時間軸">
            <div className="home-timeline__labels"><span>6</span><span>12</span><span>18</span><span>24</span></div>
            <div className="home-timeline__track">
              <i className="home-timeline__now" style={{ left: `${timelinePosition(format(now, "HH:mm")) ?? 0}%` }} />
              {todayEvents.map((event) => {
                const left = timelinePosition(event.startTime);
                return left === null ? null : <i key={event.id} className="home-timeline__event" style={{ left: `${left}%` }} />;
              })}
            </div>
            <Link to="/schedule?view=calendar">カレンダー <ArrowUpRight size={12} /></Link>
          </div>
        </article>

        <article className={`home-module home-module--tasks home-module--reflect ${todayTasks.length === 0 ? "is-empty" : "has-data"}`}>
          <ModuleHeading icon={CheckSquare} eyebrow="今日のタスク" action={<span className="home-module__count">{doneCount} / {todayTasks.length}</span>} />
          <div className="home-task__progress">
            <div className="home-progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}><span>{progress}<small>%</small></span></div>
            <div><p className="home-module__title">{todayTasks.length ? (progress === 100 ? "今日の分は完了" : `あと${todayTasks.length - doneCount}件`) : "タスクはありません"}</p><p className="home-module__meta">小さな一歩から、整えていきましょう。</p></div>
          </div>
          {previewTasks.length > 0 ? (
            <div className="home-task__list">
              {previewTasks.map((task) => <div key={task.id} className={`home-task__row ${task.completed ? "is-done" : ""}`}><button type="button" onClick={() => toggleTaskCompletion(task)} aria-label={`${task.title}の完了を切り替え`}>{task.completed ? <Check size={11} strokeWidth={2.7} /> : <Circle size={14} strokeWidth={1.5} />}</button><Link to="/schedule?view=list">{task.title}</Link>{task.dueTime && <time>{task.dueTime}</time>}</div>)}
            </div>
          ) : <div className="home-task__empty"><span>0 tasks</span><Link to="/schedule?view=list">タスクを開く <ArrowUpRight size={12} /></Link></div>}
        </article>

        <Link to="/records/expense" className="home-module home-module--finance home-module--interactive">
          <ModuleHeading icon={Wallet} eyebrow="使えるお金" action={<ChevronRight size={15} />} />
          <div className={`home-finance__value ${budget && budget.remaining < 0 ? "is-negative" : ""}`}><span>¥</span>{budget ? budget.remaining.toLocaleString() : "---"}</div>
          <p className="home-module__meta">{budget ? `1日あたり ¥${Math.max(0, budget.perDayUsable).toLocaleString()}` : "給与を登録すると自動計算します"}</p>
          <div className={`home-finance__bars ${budget ? "has-data" : "is-placeholder"}`} role="img" aria-label={budget ? "収入、固定費差引後、現在残高の比較" : "家計データ未登録のプレースホルダー"}>
            {financeBars.map((item) => <span key={item.label}><i style={{ height: `${Math.max(10, (Math.max(0, item.value) / financeBarMax) * 100)}%` }} /><small>{item.label}</small></span>)}
          </div>
          {budget && <div className="home-finance__facts"><span>支出 ¥{budget.actualSpending.toLocaleString()}</span><span>固定費 ¥{budget.totalFixedCosts.toLocaleString()}</span></div>}
        </Link>

        <article className={`home-module home-module--gmail ${gmailPreview?.emails.length ? "has-data" : "is-empty"}`}>
          <ModuleHeading icon={Mail} eyebrow="Gmail" action={<span className={`home-connection ${gmailPreview?.connected ? "is-online" : ""}`}><i />{gmailPreview?.connected ? "Synced" : "Offline"}</span>} />
          {gmailPreview?.emails.length ? (
            <div className="home-mail__list">
              {gmailPreview.emails.map((email) => {
                const sender = parseSender(email.from);
                const unread = email.status === "unprocessed";
                return <a key={email.id} href={`/gmail/mail/${email.id}`} target="_blank" rel="noopener noreferrer" className={`home-mail__row ${unread ? "is-unread" : ""}`}><span className={`home-mail__avatar ${avatarColor(sender.email)}`}>{avatarInitial(sender.name)}</span><span className="home-mail__copy"><strong>{sender.name}</strong><small>{email.subject}</small></span><time>{formatGmailTimestamp(email.receivedAt)}</time>{unread && <i />}</a>;
              })}
            </div>
          ) : <div className="home-compact-state"><span className="home-compact-state__icon"><Mail size={20} /></span><div><strong>{gmailPreview?.connected ? "受信トレイは空です" : "Gmailを接続"}</strong><p>{gmailPreview?.connected ? "新しいメールはありません" : "最新メールと返信案をここで確認"}</p><Link to="/gmail">{gmailPreview?.connected ? "受信トレイを開く" : "接続画面を開く"} <ArrowUpRight size={12} /></Link></div><div className="home-mail__signal" aria-hidden="true"><i /><i /><i /></div></div>}
          {Boolean(gmailPreview?.emails.length) && <Link to="/gmail" className="home-module__footer">受信トレイを開く <ArrowUpRight size={14} /></Link>}
        </article>

        <Link to="/records/notes" className="home-module home-module--notes home-module--interactive">
          <ModuleHeading icon={NotebookPen} eyebrow="メモとリスト" action={<ChevronRight size={15} />} />
          <div className="home-notes__stack">
            {noteSummaries.map(({ definition, count, latestTitle }) => { const Icon = definition.icon; const compactLabel = definition.value === "checklist" ? "チェック" : definition.value === "shopping" ? "買い物" : definition.label; return <div key={definition.value} className="home-notes__row" title={latestTitle ?? `${definition.label}はまだありません`}><span><Icon size={15} /></span><b>{count}</b><div><strong>{compactLabel}</strong><small>{latestTitle ?? "空のリスト"}</small></div></div>; })}
          </div>
        </Link>

        <Link to="/trips" className="home-module home-module--travel home-module--interactive">
          <div className="home-travel__image" aria-hidden="true" /><div className="home-travel__veil" aria-hidden="true" />
          <div className="home-travel__content">
            <ModuleHeading icon={Plane} eyebrow="次の旅" action={<span className="home-travel__status">{featuredTrip ? TRIP_STATUS_LABEL[featuredTrip.status] : "Plan a trip"}</span>} />
            <div className="home-travel__destination">
              {featuredTrip ? <><p>{featuredTrip.destination || featuredTrip.name}</p><span><MapPin size={13} />{formatDisplayDate(featuredTrip.startDate)} 〜 {formatDisplayDate(featuredTrip.endDate)}</span>{tripDays !== null && tripDays >= 0 && <strong>{tripDays === 0 ? "TODAY" : `あと ${tripDays} 日`}</strong>}</> : <><p>Where to next?</p><span>次の景色を計画しましょう</span></>}
              <span className="home-travel__cta">{featuredTrip ? "旅程を見る" : "旅を計画"} <ArrowUpRight size={12} /></span>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
