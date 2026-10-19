import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import { toDateStr } from "./date";
import { occursOn, spanDayIndex, type TimedSpan } from "./eventSpan";
import { daysUntil, nextBillingDate, summarizeSubscriptions, type SubscriptionItem } from "./subscriptions";
import { isFixedExpense } from "./fixedCosts";

/**
 * ホーム(TOP)の組み直し(Cowork「LIFE HUB ホームのレイアウト案」2026-10-16、実装 2026-10-17)。
 * 8ブロック・縦約1,000px だったホームを、4ブロック・1画面に収める。
 *   1. 今日の1行(日付＋状態)
 *   2. お金(黒)＋気になること(白)
 *   3. 今日と、この先(今日・明日・明後日の予定とタスク)
 *   4. 次の旅行(写真)＋Gmail(白)
 * 外したもの: 今日のまとめ(予定・重要な未読は下のカードと重なる)、最近使われていない機能(暮らしの情報ではない)、
 * LIFE HUB をそろえる(残りは「気になること」の行に入れる)。
 * ここは「何を出すか」の決め方だけ(通信も描画もしない)。
 */

/** 「今日と、この先」に出す日数(今日を含む)。2026-10-18(「寂しくないホーム」1-1)に 3 → 7 の帯にした。 */
export const AHEAD_DAYS = 7;
/** 帯の下に出す、この先の予定とタスクの行数。 */
export const UPCOMING_ROWS = 4;
/** 「次の請求」に出すサブスクの数。 */
export const HOME_SUBSCRIPTION_ROWS = 3;
/** 請求日がこの日数以内なら琥珀の点(気になることと同じ意味)。 */
export const SUBSCRIPTION_SOON_DAYS = 7;
/** 次の旅行を大きな写真のカードで出す、出発までの日数の上限。これより先は1行の帯。 */
export const TRIP_BIG_WITHIN_DAYS = 30;

export function aheadDates(today: string, days = AHEAD_DAYS): string[] {
  const base = parseISO(today);
  return Array.from({ length: days }, (_, i) => toDateStr(addDays(base, i)));
}

/** 「今日」「明日」「明後日」。それより先は空(日付だけ出す)。 */
export function aheadDayLabel(date: string, today: string): string {
  const diff = differenceInCalendarDays(parseISO(date), parseISO(today));
  return ["今日", "明日", "明後日"][diff] ?? "";
}

/** 日付の下に出す今日の状態の一言。見出しは「何が」ではなく「状態」(第5弾 C-4 と同じ考え方)。 */
export function homeStatusLine(eventCount: number | undefined, openTasks: number | undefined): string {
  if (eventCount === undefined || openTasks === undefined) return "";
  const parts = [eventCount > 0 ? `予定${eventCount}件` : "", openTasks > 0 ? `タスク${openTasks}件` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join("・") : "今日は予定もタスクもありません";
}

export type TripCardSize = "big" | "compact";

/** 旅行中か、出発まで30日以内なら大きな写真のカード。それより先は高さを控えめにした写真のカード(帯はやめた、2026-10-18)。 */
export function tripCardSize(trip: { status: string; startDate: string; endDate: string }, today: string): TripCardSize {
  if (trip.status === "ongoing") return "big";
  if (trip.startDate <= today && today <= trip.endDate) return "big";
  const days = differenceInCalendarDays(parseISO(trip.startDate), parseISO(today));
  return days >= 0 && days <= TRIP_BIG_WITHIN_DAYS ? "big" : "compact";
}

/** 旅行カードの大きな文字: 「あと70日」「本日出発」「2日目」。終わった旅行は空。 */
export function tripCountdown(trip: { status: string; startDate: string; endDate: string }, today: string): string {
  const days = differenceInCalendarDays(parseISO(trip.startDate), parseISO(today));
  if (trip.status !== "ongoing") {
    if (days === 0) return "本日出発";
    if (days > 0) return `あと${days}日`;
  }
  if (trip.status === "ongoing" || today <= trip.endDate) return `${Math.max(1, 1 - days)}日目`;
  return "";
}

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

export interface StripDay {
  date: string;
  weekday: string;
  day: number;
  isToday: boolean;
  events: number;
  tasks: number;
}

interface TaskLike {
  dueDate?: string;
  dueTime?: string;
  completed: boolean;
  parentTaskId?: string;
}

/** 7日の帯。日ごとの予定の数と(まだ終わっていない)タスクの数。0 はそのまま 0(点を出さないのは描く側)。 */
export function weekStrip(dates: string[], events: TimedSpan[], tasks: TaskLike[], today: string): StripDay[] {
  return dates.map((date) => ({
    date,
    weekday: WEEKDAY[parseISO(date).getDay()],
    day: Number(date.slice(8, 10)),
    isToday: date === today,
    events: events.filter((event) => occursOn(event, date)).length,
    tasks: tasks.filter((task) => !task.completed && !task.parentTaskId && task.dueDate === date).length,
  }));
}

export interface UpcomingRow {
  key: string;
  kind: "event" | "task";
  date: string;
  time?: string;
  title: string;
}

function eventTime(event: TimedSpan, date: string): string | undefined {
  if (event.allDay || spanDayIndex(event, date) !== 1) return undefined;
  return event.startTime;
}

/** 帯の下の行: 今日からこの先の予定と(まだ終わっていない)タスクを、日付の近い順・時刻順に最大 limit 行。 */
export function upcomingRows<E extends TimedSpan & { id?: string; title: string }, T extends TaskLike & { id?: string; title: string }>(
  events: E[],
  tasks: T[],
  dates: string[],
  limit = UPCOMING_ROWS,
): UpcomingRow[] {
  const rows: UpcomingRow[] = [];
  for (const date of dates) {
    const dayEvents = events
      .filter((event) => occursOn(event, date))
      .map((event) => ({ key: `e:${event.id ?? event.title}:${date}`, kind: "event" as const, date, time: eventTime(event, date), title: event.title }));
    const dayTasks = tasks
      .filter((task) => !task.completed && !task.parentTaskId && task.dueDate === date)
      .map((task) => ({ key: `t:${task.id ?? task.title}:${date}`, kind: "task" as const, date, time: task.dueTime, title: task.title }));
    rows.push(...[...dayEvents, ...dayTasks].sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "")));
    if (rows.length >= limit) break;
  }
  return rows.slice(0, limit);
}

export interface WeekSpendBar {
  date: string;
  amount: number;
  /** 棒の高さ(%)。0件でなければ最低6%、0件は2%(潰れて見えないため)。 */
  heightPercent: number;
}

/** 直近7日の支出の棒(第8弾 H-1)。合計が0(記録が無い)間は空を返し、呼び出し側は案内文を出す。 */
export function weekSpendBars(dates: string[], amounts: number[]): WeekSpendBar[] {
  const max = Math.max(0, ...amounts);
  if (max <= 0) return [];
  return dates.map((date, i) => {
    const amount = amounts[i] ?? 0;
    return { date, amount, heightPercent: Math.max(amount > 0 ? 6 : 2, Math.round((amount / max) * 100)) };
  });
}

export interface HomeSubscriptionRow {
  id: string;
  title: string;
  amount: number;
  next: string;
  days: number;
  /** 7日以内の請求(琥珀の点)。 */
  soon: boolean;
  /** 押した時に開くお金管理のタブ。家賃などの固定費は「固定費」、それ以外は「サブスク」(src/lib/fixedCosts.ts)。 */
  tab: "fixed" | "subs";
}

/** 「次の請求」カード: 次に引き落とされる順に最大3件と、今月に実際に請求される合計。止めているものは数えない。 */
export function homeSubscriptions(items: SubscriptionItem[], today: string, limit = HOME_SUBSCRIPTION_ROWS): { rows: HomeSubscriptionRow[]; thisMonthCharge: number } {
  const rows = items
    .map((item) => ({ item, next: nextBillingDate(item, today) }))
    .filter((entry): entry is { item: SubscriptionItem; next: string } => entry.next !== null)
    .sort((a, b) => a.next.localeCompare(b.next) || b.item.cost.amount - a.item.cost.amount)
    .slice(0, limit)
    .map(({ item, next }) => {
      const days = daysUntil(next, today);
      return {
        id: item.cost.id ?? item.cost.title,
        title: item.cost.title,
        amount: item.cost.amount,
        next,
        days,
        soon: days <= SUBSCRIPTION_SOON_DAYS,
        tab: isFixedExpense(item.cost) ? ("fixed" as const) : ("subs" as const),
      };
    });
  return { rows, thisMonthCharge: summarizeSubscriptions(items, today).thisMonthCharge };
}

export interface Concern {
  id: string;
  /** 赤＝放っておくと困る(返信待ち・予算超え・期限切れ)。琥珀＝設定が未完(住所・連携)。 */
  tone: "red" | "amber";
  text: string;
  note?: string;
  /** 押せる所の文字(青緑)。 */
  cta: string;
  to?: string;
  action?: "expense" | "event";
}

export interface ConcernInput {
  /** 返信待ち(src/lib/replyWaiting.ts)。待っている日数の長い順。 */
  waiting: { emailId: string; name: string; waitingDays: number }[];
  /** 今のペースだと給料日までに超えそうなカテゴリ予算。 */
  forecasts: { category: string; projectedOver: number }[];
  /** 期限を過ぎた未完了のタスクの数。 */
  overdueTasks: number;
  /** 連携が切れている Gmail のアカウント。 */
  reauthEmails: string[];
  /** 「LIFE HUB をそろえる」のまだ済んでいない項目。 */
  setupItems: { id: string; label: string; to?: string; action?: "expense" | "event" }[];
}

/** 「気になること」の行。赤(放っておくと困る)を先に、琥珀(設定が未完)を後に。無ければ空(カードを出さない)。 */
export function buildConcerns(input: ConcernInput): Concern[] {
  const rows: Concern[] = [];
  for (const item of input.waiting) {
    rows.push({
      id: `waiting:${item.emailId}`,
      tone: "red",
      text: `${item.name} からの返信を ${item.waitingDays}日待っています`,
      cta: "開く",
      to: `/gmail/mail/${item.emailId}`,
    });
  }
  for (const forecast of input.forecasts) {
    rows.push({
      id: `budget:${forecast.category}`,
      tone: "red",
      text: `${forecast.category}が給料日までに予算を超えそう`,
      note: `このままだと約¥${Math.round(forecast.projectedOver).toLocaleString()}超え`,
      cta: "支出を見る",
      to: "/records/expense",
    });
  }
  if (input.overdueTasks > 0) {
    rows.push({ id: "overdue", tone: "red", text: `期限を過ぎたタスクが ${input.overdueTasks}件`, cta: "見る", to: "/schedule?view=list" });
  }
  for (const email of input.reauthEmails) {
    rows.push({ id: `reauth:${email}`, tone: "amber", text: `${email} の連携が切れています`, cta: "つなぐ", to: "/settings" });
  }
  for (const item of input.setupItems) {
    rows.push({ id: `setup:${item.id}`, tone: "amber", text: item.label, cta: "入れる", to: item.to, action: item.action });
  }
  return rows;
}
