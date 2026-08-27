import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import {
  ArrowRight,
  CalendarDays,
  CheckSquare,
  Check,
  ChevronRight,
  Mail,
  MoonStar,
  NotebookPen,
  Plane,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { db } from "../db/schema";
import type { CalendarEvent } from "../types";
import { formatDisplayDate, formatGmailTimestamp, todayStr } from "../lib/date";
import { occursOn, spanDayIndex, spanTimeText } from "../lib/eventSpan";
import { avatarColor, avatarInitial, isUnhandledEmail, parseSender } from "../lib/gmail";
import { pullBlockedSenders } from "../lib/blockedSenders";
import { NOTE_TYPE_DEFS, getNoteType } from "../lib/noteTypes";
import { tripCoverImage } from "../lib/tripCovers";
import { getScheduleCategory } from "../lib/scheduleCategories";
import { usePayPeriodBudget } from "../hooks/usePayPeriodBudget";
import { useHubMotion } from "../hooks/useHubMotion";
import { toggleTaskCompletion } from "../components/tasks/TaskList";

const EVENT_PREVIEW_LIMIT = 3;
const TASK_PREVIEW_LIMIT = 2;
const GMAIL_PREVIEW_LIMIT = 3;
const TRIP_STATUS_LABEL: Record<string, string> = { ongoing: "旅行中", planning: "計画中", completed: "完了済み" };

/** The day rail spans 6:00–24:00; anything outside clamps to an edge. */
const RAIL_START_HOUR = 6;
const RAIL_END_HOUR = 24;

function TileHead({ icon: Icon, name, trailing }: { icon: LucideIcon; name: string; trailing?: ReactNode }) {
  return (
    <div className="hub-tile__head">
      <div className="hub-tile__label">
        <span className="hub-tile__icon">
          <Icon size={18} strokeWidth={1.9} />
        </span>
        <h2 className="hub-tile__name">{name}</h2>
      </div>
      {trailing}
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

function railPosition(time: string | undefined): number | null {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const span = RAIL_END_HOUR - RAIL_START_HOUR;
  return Math.max(0, Math.min(100, ((hour + minute / 60 - RAIL_START_HOUR) / span) * 100));
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

  const tasksResult = useLiveQuery(() => db.tasks.where("dueDate").equals(today).toArray(), [today]);
  const todayTasks = (tasksResult ?? []).filter((task) => !task.parentTaskId);
  const doneCount = todayTasks.filter((task) => task.completed).length;
  const openCount = todayTasks.length - doneCount;
  const progress = todayTasks.length ? Math.round((doneCount / todayTasks.length) * 100) : 0;
  const sortedTasks = [...todayTasks].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99") ||
      a.createdAt - b.createdAt,
  );
  const nextTask = sortedTasks.find((task) => !task.completed);
  const previewTasks = sortedTasks.slice(0, TASK_PREVIEW_LIMIT);

  const { data: budget } = usePayPeriodBudget();

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
    if (accounts.length === 0) return { connected: false, emails: [] };
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
    return { connected: true, emails: visible.slice(0, GMAIL_PREVIEW_LIMIT) };
  }, []);

  const notesResult = useLiveQuery(() => db.notes.toArray(), []);
  const noteSummaries = NOTE_TYPE_DEFS.map((definition) => ({
    definition,
    count: (notesResult ?? []).filter((note) => getNoteType(note) === definition.value).length,
  }));
  const noteTotal = noteSummaries.reduce((sum, item) => sum + item.count, 0);

  const tripsResult = useLiveQuery(() => db.trips.toArray(), []);
  const featuredTrip =
    tripsResult?.find((trip) => trip.status === "ongoing") ??
    [...(tripsResult ?? [])]
      .filter((trip) => trip.status === "planning")
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const tripDays = featuredTrip ? differenceInCalendarDays(parseISO(featuredTrip.startDate), now) : null;

  const dayProgress = Math.max(0, Math.min(100, railPosition(format(now, "HH:mm")) ?? 0));

  /* The focus card answers one question — "what is next?" — falling back through
     event → open task → a settled day, so it is never empty. */
  const focus = nextEvent
    ? {
        kicker: "次の予定",
        title: nextEvent.title,
        when: spanTimeText(nextEvent, today),
        countdown: nextEventMinutes === null ? null : formatCountdown(nextEventMinutes),
        to: "/schedule?view=calendar",
        icon: CalendarDays,
      }
    : nextTask
      ? {
          kicker: "次のタスク",
          title: nextTask.title,
          when: nextTask.dueTime ? `${nextTask.dueTime} まで` : "今日じゅう",
          countdown: openCount > 1 ? `残り ${openCount} 件` : null,
          to: "/schedule?view=list",
          icon: CheckSquare,
        }
      : {
          kicker: "今日の予定",
          title: allTodayEvents.length > 0 ? "今日の予定は終わりました" : "静かな一日です",
          when:
            allTodayEvents.length > 0
              ? `本日は ${allTodayEvents.length} 件の予定がありました`
              : "予定もタスクも入っていません",
          countdown: null,
          to: "/schedule?view=calendar",
          icon: MoonStar,
        };
  const FocusIcon = focus.icon;

  return (
    <div className="hub-home" ref={motionRef}>
      <header className="hub-greeting">
        <time className="hub-greeting__date" dateTime={format(now, "yyyy-MM-dd")}>
          {format(now, "yyyy年M月d日 EEEE", { locale: ja })}
        </time>
        <p className="hub-greeting__clock">{format(now, "H:mm")}</p>
      </header>

      <div className="hub-grid">
        <Link to={focus.to} className="hub-focus hub-tap hub-span-full hub-area--focus" data-reveal="0">
          <div className="hub-focus__top">
            <span className="hub-focus__kicker">
              <FocusIcon size={15} strokeWidth={2.2} />
              {focus.kicker}
            </span>
            {focus.countdown && <span className="hub-focus__countdown">{focus.countdown}</span>}
          </div>
          <div className="hub-focus__body">
            <div className="hub-focus__date">
              <strong>{format(now, "d")}</strong>
              <span>{format(now, "EEE", { locale: ja })}</span>
            </div>
            <div className="min-w-0">
              <p className="hub-focus__title">{focus.title}</p>
              <p className="hub-focus__when">{focus.when}</p>
            </div>
            <span className="hub-focus__go" aria-hidden="true">
              <ArrowRight size={20} strokeWidth={2.2} />
            </span>
          </div>
        </Link>

        <article className="hub-tile hub-span-full hub-area--schedule hub-sheen" data-reveal="1">
          <TileHead
            icon={CalendarDays}
            name="今日の予定"
            trailing={
              <Link to="/schedule?view=calendar" className="hub-tile__go" aria-label="カレンダーを開く">
                <ChevronRight size={17} />
              </Link>
            }
          />

          {previewEvents.length > 0 ? (
            <div className="hub-events">
              {previewEvents.map((event) => {
                const category = getScheduleCategory(event.category);
                const past = !event.allDay && Boolean(timeToday(event)) && minutesUntil(timeToday(event), now) === null;
                return (
                  <Link key={event.id} to="/schedule?view=calendar" className={`hub-events__row ${past ? "is-past" : ""}`}>
                    <time>{spanTimeText(event, today)}</time>
                    <i className={`hub-dot hub-dot--${category.tone}`} aria-hidden="true" />
                    <strong>{event.title}</strong>
                    <small>{category.label}</small>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="hub-empty">
              <span className="hub-empty__icon">
                <CalendarDays size={21} />
              </span>
              <div className="min-w-0">
                <strong>予定はありません</strong>
                <p>カレンダーから追加できます</p>
              </div>
            </div>
          )}

          <div className="hub-rail" aria-hidden="true">
            <div className="hub-rail__marks">
              <span>6</span>
              <span>12</span>
              <span>18</span>
              <span>24</span>
            </div>
            <div className="hub-rail__track">
              <i className="hub-rail__fill" style={{ width: `${dayProgress}%` }} />
            </div>
            <i className="hub-rail__now" style={{ left: `${dayProgress}%` }} />
            {previewEvents.map((event) => {
              const left = railPosition(timeToday(event));
              return left === null ? null : <i key={event.id} className="hub-rail__event" style={{ left: `${left}%` }} />;
            })}
          </div>
        </article>

        <article className="hub-tile hub-span-full hub-area--tasks hub-sheen" data-reveal="2">
          <TileHead
            icon={CheckSquare}
            name="タスク"
            trailing={
              <Link to="/schedule?view=list" className="hub-tile__go" aria-label="タスク一覧を開く">
                <ChevronRight size={17} />
              </Link>
            }
          />
          <div className="hub-tasks">
            <div className="hub-ring" style={{ "--hub-progress": `${progress * 3.6}deg` } as React.CSSProperties}>
              <span>
                {progress}
                <small>%</small>
              </span>
            </div>
            {previewTasks.length > 0 ? (
              <div className="hub-tasks__list">
                {previewTasks.map((task) => (
                  <div key={task.id} className={`hub-tasks__row ${task.completed ? "is-done" : ""}`}>
                    <button
                      type="button"
                      className="hub-check"
                      onClick={() => toggleTaskCompletion(task)}
                      aria-label={`${task.title}の完了を切り替え`}
                      aria-pressed={task.completed}
                    >
                      {task.completed && <Check size={13} strokeWidth={3} />}
                    </button>
                    <Link to="/schedule?view=list">{task.title}</Link>
                    {task.dueTime && <time>{task.dueTime}</time>}
                  </div>
                ))}
                <p className="hub-tasks__summary">
                  {openCount === 0 ? "今日の分は完了" : `あと ${openCount} 件`}
                </p>
              </div>
            ) : (
              <div className="hub-tasks__list">
                <p className="hub-tasks__summary">今日のタスクはありません</p>
                <Link to="/schedule?view=list" className="hub-link" style={{ paddingTop: 0 }}>
                  タスクを追加 <ChevronRight size={16} />
                </Link>
              </div>
            )}
          </div>
        </article>

        <Link to="/records/expense" className="hub-tile hub-tile--compact hub-tap hub-area--money hub-sheen" data-reveal="3">
          <TileHead icon={Wallet} name="使えるお金" />
          <p className={`hub-metric ${budget && budget.remaining < 0 ? "is-negative" : ""}`}>
            <small>¥</small>
            {budget ? budget.remaining.toLocaleString() : "—"}
          </p>
          <p className="hub-metric__note">
            {budget ? `1日あたり ¥${Math.max(0, budget.perDayUsable).toLocaleString()}` : "給与を登録すると自動計算します"}
          </p>
        </Link>

        <Link to="/records/notes" className="hub-tile hub-tile--compact hub-tap hub-area--notes hub-sheen" data-reveal="4">
          <TileHead icon={NotebookPen} name="メモ" trailing={<span className="hub-tile__badge">{noteTotal}</span>} />
          <div className="hub-notes">
            {noteSummaries.map(({ definition, count }) => {
              const Icon = definition.icon;
              const label =
                definition.value === "checklist" ? "チェック" : definition.value === "shopping" ? "買い物" : definition.label;
              return (
                <div key={definition.value} className="hub-notes__row">
                  <Icon size={15} />
                  <span>{label}</span>
                  <b>{count}</b>
                </div>
              );
            })}
          </div>
        </Link>

        <article className="hub-tile hub-span-full hub-area--mail hub-sheen" data-reveal="5">
          <TileHead
            icon={Mail}
            name="Gmail"
            trailing={
              <span className={`hub-status ${gmailPreview?.connected ? "is-online" : ""}`}>
                <i aria-hidden="true" />
                {gmailPreview?.connected ? "同期中" : "未接続"}
              </span>
            }
          />
          {gmailPreview?.emails.length ? (
            <>
              <div className="hub-mails">
                {gmailPreview.emails.map((email) => {
                  const sender = parseSender(email.from);
                  const unread = email.status === "unprocessed";
                  return (
                    <a
                      key={email.id}
                      href={`/gmail/mail/${email.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`hub-mails__row ${unread ? "is-unread" : ""}`}
                    >
                      <span className={`hub-avatar ${avatarColor(sender.email)}`}>{avatarInitial(sender.name)}</span>
                      <span className="hub-mails__copy">
                        <strong>{sender.name}</strong>
                        <small>{email.subject}</small>
                      </span>
                      <span className="hub-mails__meta">
                        <time>{formatGmailTimestamp(email.receivedAt)}</time>
                        {unread && <i aria-hidden="true" />}
                      </span>
                    </a>
                  );
                })}
              </div>
              <Link to="/gmail" className="hub-link">
                受信トレイを開く <ChevronRight size={16} />
              </Link>
            </>
          ) : (
            <>
              <div className="hub-empty">
                <span className="hub-empty__icon">
                  <Mail size={21} />
                </span>
                <div className="min-w-0">
                  <strong>{gmailPreview?.connected ? "未処理のメールはありません" : "Gmailを接続"}</strong>
                  <p>{gmailPreview?.connected ? "既読・返信済みは受信トレイで見られます" : "最新メールと返信案をここで確認"}</p>
                </div>
              </div>
              <Link to="/gmail" className="hub-link">
                {gmailPreview?.connected ? "受信トレイを開く" : "接続画面を開く"} <ChevronRight size={16} />
              </Link>
            </>
          )}
        </article>

        <Link to="/trips" className="hub-trip hub-tap hub-span-full hub-area--trip" data-reveal="6">
          <div
            className="hub-trip__photo"
            style={featuredTrip ? { backgroundImage: `url('${tripCoverImage(featuredTrip.destination || featuredTrip.name)}')` } : undefined}
            aria-hidden="true"
          />
          <div className="hub-trip__veil" aria-hidden="true" />
          <span className="hub-trip__kicker">
            <Plane size={14} strokeWidth={2.2} />
            {featuredTrip ? TRIP_STATUS_LABEL[featuredTrip.status] : "次の旅"}
          </span>
          <p className="hub-trip__place">{featuredTrip ? featuredTrip.destination || featuredTrip.name : "次はどこへ"}</p>
          <p className="hub-trip__when">
            {featuredTrip
              ? `${formatDisplayDate(featuredTrip.startDate)} 〜 ${formatDisplayDate(featuredTrip.endDate)}`
              : "旅の計画を立てましょう"}
          </p>
          {featuredTrip && tripDays !== null && tripDays >= 0 && (
            <span className="hub-trip__count">{tripDays === 0 ? "本日出発" : `あと ${tripDays} 日`}</span>
          )}
        </Link>
      </div>
    </div>
  );
}
