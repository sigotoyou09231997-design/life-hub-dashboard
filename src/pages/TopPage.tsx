import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import type { Session } from "@supabase/auth-js";
import {
  ArrowRight,
  CalendarDays,
  CheckSquare,
  Check,
  Mail,
  NotebookPen,
  Plane,
  Wallet,
} from "lucide-react";
import { db } from "../db/schema";
import type { CalendarEvent } from "../types";
import { auth, isSupabaseConfigured } from "../lib/supabase";
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
const TASK_PREVIEW_LIMIT = 3;
const GMAIL_PREVIEW_LIMIT = 3;
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

function greetingFor(hour: number): string {
  if (hour < 4) return "おつかれさま";
  if (hour < 11) return "おはよう";
  if (hour < 18) return "こんにちは";
  return "こんばんは";
}

/** 参考デザインの「色分けされた円形アイコン」の行。色は機能ごとに固定
 *  （予定=青・タスク=緑・お金管理=紫・メモ=オレンジ・Gmail=赤・旅行=ティール）。 */
const QUICK_LINKS = [
  { to: "/schedule?view=calendar", label: "予定", icon: CalendarDays, tone: "var(--tone-schedule)", tint: "rgba(75,131,224,.12)" },
  { to: "/schedule?view=list", label: "タスク", icon: CheckSquare, tone: "var(--tone-task)", tint: "rgba(63,170,114,.12)" },
  { to: "/records/expense", label: "お金管理", icon: Wallet, tone: "var(--tone-money)", tint: "rgba(139,111,212,.12)" },
  { to: "/records/notes", label: "メモ", icon: NotebookPen, tone: "var(--tone-notes)", tint: "rgba(224,138,72,.13)" },
  { to: "/gmail", label: "Gmail", icon: Mail, tone: "var(--tone-gmail)", tint: "rgba(221,92,82,.12)" },
  { to: "/trips", label: "旅行", icon: Plane, tone: "var(--tone-trip)", tint: "rgba(74,168,160,.13)" },
] as const;

/** 一番下の、写真つきの機能カード。 */
const FEATURE_CARDS = [
  { to: "/schedule", photo: "/backgrounds/morning-white-atrium-v5.jpg", title: "予定・タスク", note: "その日の段取りを、ひと目で。" },
  { to: "/records/expense", photo: "/backgrounds/evening-warm-atrium-v5.jpg", title: "お金管理", note: "収支を見える化して、賢く使う。" },
  { to: "/records/notes", photo: "/backgrounds/morning-villa-gallery-v5.jpg", title: "メモ・リスト", note: "思いついたことを、すぐ記録。" },
  { to: "/gmail", photo: "/backgrounds/day-white-courtyard-v5.jpg", title: "Gmail", note: "大切なメールを、見落とさずに。" },
  { to: "/trips", photo: "/backgrounds/morning-coastal-pavilion-v5.jpg", title: "旅行計画", note: "計画から思い出まで、ひと所に。" },
  { to: "/settings", photo: "/backgrounds/day-concrete-gallery-v5.jpg", title: "設定", note: "自分に合う使い心地に整える。" },
] as const;

function CardHead({ title, to, trailing }: { title: string; to?: string; trailing?: ReactNode }) {
  return (
    <div className="warm-card__head">
      <h2 className="warm-card__title">{title}</h2>
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

  // あいさつに名前を出すため。ヘッダー(AppHeader)と同じ読み方をしている。
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);
  const fullName = session?.user.user_metadata?.full_name as string | undefined;
  // メールアドレスをそのまま「◯◯さん」に入れると長すぎるので、@ の前だけ使う。
  const displayName = (fullName ?? session?.user.email?.split("@")[0] ?? "").trim();

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
  const doneEvents = allTodayEvents.filter(
    (event) => !event.allDay && Boolean(timeToday(event)) && minutesUntil(timeToday(event), now) === null,
  ).length;

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
    if (accounts.length === 0) return { connected: false, emails: [], total: 0 };
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
    return { connected: true, emails: visible.slice(0, GMAIL_PREVIEW_LIMIT), total: visible.length };
  }, []);

  const notesResult = useLiveQuery(() => db.notes.toArray(), []);
  const noteTotal = NOTE_TYPE_DEFS.reduce(
    (sum, definition) => sum + (notesResult ?? []).filter((note) => getNoteType(note) === definition.value).length,
    0,
  );

  const tripsResult = useLiveQuery(() => db.trips.toArray(), []);
  const featuredTrip =
    tripsResult?.find((trip) => trip.status === "ongoing") ??
    [...(tripsResult ?? [])]
      .filter((trip) => trip.status === "planning")
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const tripDays = featuredTrip ? differenceInCalendarDays(parseISO(featuredTrip.startDate), now) : null;

  const hour = now.getHours();
  const hero = heroFor(hour);

  return (
    <div className="warm-home" ref={motionRef}>
      <header className="warm-greet">
        <h1 className="warm-greet__hello">
          {greetingFor(hour)}
          {displayName && `、${displayName}さん`} 🌿
        </h1>
        <p className="warm-greet__sub">今日も、心にゆとりのある一日を。</p>
      </header>

      <div className="warm-top">
        <section className="warm-hero" data-reveal="0">
          <div className="warm-hero__photo" style={{ backgroundImage: `url('${hero.src}')` }} aria-hidden="true" />
          <div className="warm-hero__veil" aria-hidden="true" />
          <div className="warm-hero__copy">
            <time className="warm-hero__date" dateTime={format(now, "yyyy-MM-dd")}>
              {format(now, "yyyy.M.d (EEE)", { locale: ja })}
            </time>
            <p className="warm-hero__clock">
              {format(now, "h:mm")}
              <small>{hour < 12 ? "AM" : "PM"}</small>
            </p>
            <p className="warm-hero__quote">{hero.quote}</p>
          </div>
        </section>

        <Link to="/review" className="warm-card" data-reveal="1">
          <CardHead title="今日のハイライト" />
          <div className="warm-highlight__body">
            <div className="warm-ring" style={{ "--warm-progress": `${progress * 3.6}deg` } as CSSProperties}>
              <span>
                {progress}
                <small>%</small>
              </span>
            </div>
            <ul className="warm-stats">
              <li>
                <i className="warm-dot warm-dot--task" aria-hidden="true" />
                <span>タスク進捗</span>
                <b>{doneCount}/{todayTasks.length}</b>
              </li>
              <li>
                <i className="warm-dot warm-dot--schedule" aria-hidden="true" />
                <span>予定完了</span>
                <b>{doneEvents}/{allTodayEvents.length}</b>
              </li>
              <li>
                <i className="warm-dot warm-dot--money" aria-hidden="true" />
                <span>使えるお金</span>
                <b>{budget ? `¥${budget.remaining.toLocaleString()}` : "—"}</b>
              </li>
              <li>
                <i className="warm-dot warm-dot--notes" aria-hidden="true" />
                <span>メモ</span>
                <b>{noteTotal}件</b>
              </li>
            </ul>
          </div>
          <span className="warm-card__foot">
            ふりかえりを見る <ArrowRight size={14} />
          </span>
        </Link>

        <Link to="/trips" className="warm-trip" data-reveal="2">
          <div
            className="warm-trip__photo"
            style={featuredTrip ? { backgroundImage: `url('${tripCoverImage(featuredTrip.destination || featuredTrip.name)}')` } : undefined}
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
      </div>

      <nav className="warm-quick" aria-label="よく使う機能" data-reveal="3">
        {QUICK_LINKS.map(({ to, label, icon: Icon, tone, tint }) => (
          <Link key={label} to={to} className="warm-quick__item">
            <span className="warm-quick__icon" style={{ "--tone": tone, "--tint": tint } as CSSProperties}>
              <Icon size={21} strokeWidth={1.9} />
            </span>
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <div className="warm-lists">
        <article className="warm-card" data-reveal="4">
          <CardHead title="次の予定" to="/schedule?view=calendar" />
          {previewEvents.length > 0 ? (
            <div className="warm-list">
              {previewEvents.map((event) => {
                const category = getScheduleCategory(event.category);
                const time = timeToday(event);
                const past = !event.allDay && Boolean(time) && minutesUntil(time, now) === null;
                const countdown =
                  event.id === nextEvent?.id && nextEventMinutes !== null ? formatCountdown(nextEventMinutes) : null;
                return (
                  <Link
                    key={event.id}
                    to="/schedule?view=calendar"
                    className={`warm-list__row ${past ? "is-past" : ""}`}
                  >
                    <i className={`warm-dot warm-dot--${category.tone}`} aria-hidden="true" style={{ marginTop: ".4rem" }} />
                    <span className="warm-list__time">{spanTimeText(event, today)}</span>
                    <span className="warm-list__copy">
                      <strong>{event.title}</strong>
                      <small>{event.location || category.label}</small>
                    </span>
                    {countdown && <span className="warm-list__meta">{countdown}</span>}
                  </Link>
                );
              })}
            </div>
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
        </article>

        <article className="warm-card" data-reveal="5">
          {/* 「◯/◯ 完了」を出す時は「すべて見る」を横に並べず、下のリンクにまとめる
              （4分割の狭い列では見出しが2行に折れてしまうため）。 */}
          <CardHead
            title="今日のタスク"
            trailing={
              todayTasks.length > 0 ? (
                <span className="warm-card__badge">{doneCount}/{todayTasks.length} 完了</span>
              ) : undefined
            }
          />
          {previewTasks.length > 0 ? (
            <div className="warm-list">
              {previewTasks.map((task) => (
                <div key={task.id} className={`warm-list__row ${task.completed ? "is-done" : ""}`}>
                  <button
                    type="button"
                    className="warm-check"
                    onClick={() => toggleTaskCompletion(task)}
                    aria-label={`${task.title}の完了を切り替え`}
                    aria-pressed={task.completed}
                    style={{ marginTop: ".08rem" }}
                  >
                    <Check size={12} strokeWidth={3.2} />
                  </button>
                  <Link to="/schedule?view=list" className="warm-list__copy">
                    <strong>{task.title}</strong>
                  </Link>
                  {task.dueTime && <span className="warm-list__meta">{task.dueTime}</span>}
                </div>
              ))}
            </div>
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
          <Link to="/schedule?view=list" className="warm-card__foot">
            {openCount > 0 ? `すべてのタスクを見る（あと ${openCount} 件）` : "すべてのタスクを見る"}
            <ArrowRight size={14} />
          </Link>
        </article>

        <Link to="/records/expense" className="warm-card" data-reveal="6">
          <CardHead title="今月のお金" />
          <p className={`warm-amount ${budget && budget.remaining < 0 ? "is-negative" : ""}`}>
            <small>¥</small>
            {budget ? budget.remaining.toLocaleString() : "—"}
          </p>
          <p className="warm-amount__note">
            {budget ? `1日あたり ¥${Math.max(0, budget.perDayUsable).toLocaleString()} 使えます` : "給与を登録すると自動計算します"}
          </p>
          <span className="warm-card__foot">
            詳細をチェック <ArrowRight size={14} />
          </span>
        </Link>

        <article className="warm-card" data-reveal="7">
          <CardHead
            title="Gmail"
            to={gmailPreview?.total ? undefined : "/gmail"}
            trailing={
              gmailPreview?.total ? <span className="warm-card__badge">{gmailPreview.total}件の未処理</span> : undefined
            }
          />
          {gmailPreview?.emails.length ? (
            <div className="warm-list">
              {gmailPreview.emails.map((email) => {
                const sender = parseSender(email.from);
                return (
                  <a
                    key={email.id}
                    href={`/gmail/mail/${email.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="warm-list__row"
                  >
                    <span className={`warm-avatar ${avatarColor(sender.email)}`}>{avatarInitial(sender.name)}</span>
                    <span className="warm-list__copy">
                      <strong>{sender.name}</strong>
                      <small>{email.subject}</small>
                    </span>
                    <span className="warm-list__meta">{formatGmailTimestamp(email.receivedAt)}</span>
                  </a>
                );
              })}
            </div>
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
          <Link to="/gmail" className="warm-card__foot">
            {gmailPreview?.connected ? "すべてのメールを見る" : "接続画面を開く"} <ArrowRight size={14} />
          </Link>
        </article>
      </div>

      <div className="warm-features" data-reveal="8">
        {FEATURE_CARDS.map(({ to, photo, title, note }) => (
          <Link key={to} to={to} className="warm-feature">
            <div className="warm-feature__photo" style={{ backgroundImage: `url('${photo}')` }} aria-hidden="true" />
            <div className="warm-feature__copy">
              <strong>{title}</strong>
              <small>{note}</small>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
