import { addDays, differenceInCalendarDays, format, getDaysInMonth, parseISO } from "date-fns";
import type { BillingCycle, FixedCost, SubscriptionDetail } from "../types";

/**
 * サブスク管理(お金管理の「サブスク」タブ、2026-10-12・参考: サブスクBOX)の計算。
 *
 * 1件のサブスク = 固定費(FixedCost)＋付け足し(SubscriptionDetail、無いこともある)。
 * 付け足しが無い固定費は、いままでどおり「毎月 dueDay 日に払う」もの。
 *
 * 日付はすべて端末のローカル日付の文字列(YYYY-MM-DD)で比べる(src/lib/date.ts の todayStr)。
 */

export interface SubscriptionItem {
  cost: FixedCost;
  detail?: SubscriptionDetail;
}

/**
 * - active: 請求が続いている
 * - trial: 無料体験中(終わる日から請求が始まる)
 * - scheduled: 契約開始日が未来(開始予定)
 * - cancelled: 解約した／止めている
 */
export type SubscriptionStatus = "active" | "trial" | "scheduled" | "cancelled";

/** 固定費とその付け足しを1件ずつに組む。 */
export function pairSubscriptions(costs: FixedCost[], details: SubscriptionDetail[]): SubscriptionItem[] {
  const byCost = new Map<string, SubscriptionDetail>();
  for (const detail of details) byCost.set(detail.fixedCostId, detail);
  return costs.map((cost) => ({ cost, detail: cost.id ? byCost.get(cost.id) : undefined }));
}

export function cycleOf(item: SubscriptionItem): BillingCycle {
  return item.detail?.cycle === "yearly" ? "yearly" : "monthly";
}

/** 年払いの請求月(1〜12)。付け足しに無い・壊れているときは1月にしておく。 */
function billingMonthOf(item: SubscriptionItem): number {
  const month = Math.trunc(item.detail?.billingMonth ?? 1);
  return month >= 1 && month <= 12 ? month : 1;
}

/** 請求が始まる日。これより前の請求日は数えない(契約開始日と無料体験の終わりの遅い方)。 */
export function firstBillingDate(item: SubscriptionItem): string | undefined {
  const dates = [item.detail?.startDate, item.detail?.trialEndDate].filter((d): d is string => !!d);
  if (dates.length === 0) return undefined;
  return dates.sort().at(-1);
}

export function statusOf(item: SubscriptionItem, today: string): SubscriptionStatus {
  if (!item.cost.active) return "cancelled";
  // 無料体験が終わる日そのものは、もう請求日(active)。
  if (item.detail?.trialEndDate && today < item.detail.trialEndDate) return "trial";
  if (item.detail?.startDate && today < item.detail.startDate) return "scheduled";
  return "active";
}

/** その年・月の請求日。29〜31日払いの月は末日に丸める(fixedCostCalendar.ts と同じ考え方)。 */
export function billingDateIn(year: number, month1: number, dueDay: number): string {
  const lastDay = getDaysInMonth(new Date(year, month1 - 1, 1));
  const day = Math.min(Math.max(Math.trunc(dueDay) || 1, 1), lastDay);
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addMonths(year: number, month1: number, offset: number): { year: number; month1: number } {
  const index = year * 12 + (month1 - 1) + offset;
  return { year: Math.floor(index / 12), month1: (index % 12) + 1 };
}

/** 支払いの予定に乗っている日(請求の始まり・止めているかは見ない)を、from の月から順に出す。 */
function* scheduleFrom(item: SubscriptionItem, from: string, months: number): Generator<string> {
  const startYear = Number(from.slice(0, 4));
  const startMonth = Number(from.slice(5, 7));
  const yearly = cycleOf(item) === "yearly";
  const billingMonth = billingMonthOf(item);
  for (let offset = 0; offset < months; offset++) {
    const { year, month1 } = addMonths(startYear, startMonth, offset);
    if (yearly && month1 !== billingMonth) continue;
    yield billingDateIn(year, month1, item.cost.dueDay);
  }
}

/**
 * start〜end(両端を含む)の間に来る請求日。止めているもの・請求が始まる前の日は入れない。
 * カレンダーの帯と、給料日から次の給料日までの固定費の計算に使う。
 */
export function billingDatesInRange(item: SubscriptionItem, start: string, end: string): string[] {
  if (!item.cost.active || start > end) return [];
  const first = firstBillingDate(item);
  const months =
    (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1;
  const dates: string[] = [];
  for (const date of scheduleFrom(item, start, months)) {
    if (date < start || date > end) continue;
    if (first && date < first) continue;
    dates.push(date);
  }
  return dates;
}

/** 次の請求日(今日を含む)。止めているものは null。無料体験中・開始予定なら最初の請求日。 */
export function nextBillingDate(item: SubscriptionItem, today: string): string | null {
  if (!item.cost.active) return null;
  const first = firstBillingDate(item);
  const from = first && first > today ? first : today;
  for (const date of scheduleFrom(item, from, 25)) {
    if (date >= from) return date;
  }
  return null;
}

export function daysUntil(date: string, today: string): number {
  return differenceInCalendarDays(parseISO(date), parseISO(today));
}

/** 「今日」「明日」「あと N 日」。 */
export function remainingLabel(days: number): string {
  if (days <= 0) return "今日";
  if (days === 1) return "明日";
  return `あと${days}日`;
}

/** 残り日数の色の段階(青緑 → 橙 → 赤)。 */
export function urgencyOf(days: number): "calm" | "soon" | "urgent" {
  if (days <= 2) return "urgent";
  if (days <= 7) return "soon";
  return "calm";
}

/**
 * いまの周期がどこまで進んだか(0〜1)。前の請求日から次の請求日までのうち、今日まで
 * 過ぎた割合。次の請求日までの棒に使う。
 */
export function cycleProgress(item: SubscriptionItem, today: string): number {
  const next = nextBillingDate(item, today);
  if (!next) return 0;
  const step = cycleOf(item) === "yearly" ? -12 : -1;
  const { year, month1 } = addMonths(Number(next.slice(0, 4)), Number(next.slice(5, 7)), step);
  const previous = billingDateIn(year, month1, item.cost.dueDay);
  const length = daysUntil(next, previous);
  if (length <= 0) return 0;
  return Math.min(1, Math.max(0, daysUntil(today, previous) / length));
}

/** 1か月あたりに直した額(年払いは12で割る)。 */
export function monthlyEquivalent(item: SubscriptionItem): number {
  return cycleOf(item) === "yearly" ? item.cost.amount / 12 : item.cost.amount;
}

/** 1年あたりに直した額(毎月払いは12倍)。 */
export function yearlyEquivalent(item: SubscriptionItem): number {
  return cycleOf(item) === "yearly" ? item.cost.amount : item.cost.amount * 12;
}

/** 「毎月20日」「毎年3月1日」。 */
export function scheduleLabel(item: SubscriptionItem): string {
  if (cycleOf(item) === "yearly") return `毎年${billingMonthOf(item)}月${item.cost.dueDay}日`;
  return `毎月${item.cost.dueDay}日`;
}

/**
 * 給料日から次の給料日の前日まで(periodStart〜periodEnd、両端を含む)に払う額。
 * 「使えるお金」から先に引く固定費(src/hooks/usePayPeriodBudget.ts)。
 *
 * 毎月払いは、いままでどおり1期に1回ぶんを数える(支払日が期のどこにあるかは見ない —
 * 給料日と支払日の並びで0回や2回になって、月によって残額が大きく揺れるのを避ける)。
 * ただし請求がまだ始まっていない(無料体験中・開始予定で、始まる日が期の後)なら0。
 * 年払いは、請求日が期の中にあるときだけ数える。
 */
export function chargeInPeriod(item: SubscriptionItem, periodStart: string, periodEnd: string): number {
  if (!item.cost.active) return 0;
  if (cycleOf(item) === "yearly") {
    return billingDatesInRange(item, periodStart, periodEnd).length * item.cost.amount;
  }
  const first = firstBillingDate(item);
  if (first && first > periodEnd) return 0;
  return item.cost.amount;
}

export interface CategoryShare {
  category: string;
  monthly: number;
  items: SubscriptionItem[];
}

export interface SubscriptionSummary {
  /** 請求が続いているもの(active)。合計に入れるのはこれだけ。 */
  active: SubscriptionItem[];
  trial: SubscriptionItem[];
  scheduled: SubscriptionItem[];
  cancelled: SubscriptionItem[];
  monthlyTotal: number;
  yearlyTotal: number;
  yearlyCount: number;
  /** その月に実際に請求される額(月額換算ではなく、払う日が来るものだけ)。 */
  thisMonthCharge: number;
  /** 1か月あたりの額が大きい順に3件。 */
  top: SubscriptionItem[];
  byCategory: CategoryShare[];
  /** 解約したもの(cancelledAt があるもの)を続けていたら、毎月かかっていた額。 */
  savedMonthly: number;
  /** 解約した日から今日までに来るはずだった請求の合計(＝実際に浮いた額)。 */
  savedSoFar: number;
}

export function summarizeSubscriptions(items: SubscriptionItem[], today: string): SubscriptionSummary {
  const groups: Record<SubscriptionStatus, SubscriptionItem[]> = { active: [], trial: [], scheduled: [], cancelled: [] };
  for (const item of items) groups[statusOf(item, today)].push(item);
  const { active } = groups;

  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = billingDateIn(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 31);
  const thisMonthCharge = items.reduce(
    (sum, item) => sum + billingDatesInRange(item, monthStart, monthEnd).length * item.cost.amount,
    0,
  );

  const categories = new Map<string, CategoryShare>();
  for (const item of active) {
    const share = categories.get(item.cost.category) ?? { category: item.cost.category, monthly: 0, items: [] };
    share.monthly += monthlyEquivalent(item);
    share.items.push(item);
    categories.set(item.cost.category, share);
  }
  const byCategory = [...categories.values()]
    .map((share) => ({ ...share, items: [...share.items].sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a)) }))
    .sort((a, b) => b.monthly - a.monthly);

  let savedMonthly = 0;
  let savedSoFar = 0;
  for (const item of groups.cancelled) {
    const cancelledAt = item.detail?.cancelledAt;
    if (!cancelledAt) continue;
    savedMonthly += monthlyEquivalent(item);
    // 続けていたら来ていたはずの請求日を、解約した翌日から今日まで数える。
    const asIfActive: SubscriptionItem = { cost: { ...item.cost, active: true }, detail: item.detail };
    savedSoFar += billingDatesInRange(asIfActive, nextDay(cancelledAt), today).length * item.cost.amount;
  }

  return {
    ...groups,
    monthlyTotal: active.reduce((sum, item) => sum + monthlyEquivalent(item), 0),
    yearlyTotal: active.reduce((sum, item) => sum + yearlyEquivalent(item), 0),
    yearlyCount: active.filter((item) => cycleOf(item) === "yearly").length,
    thisMonthCharge,
    top: [...active].sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a)).slice(0, 3),
    byCategory,
    savedMonthly,
    savedSoFar,
  };
}

function nextDay(date: string): string {
  return format(addDays(parseISO(date), 1), "yyyy-MM-dd");
}

/** 次の請求日が近い順(同じ日なら金額の大きい順)。止めているものは後ろ。 */
export function sortByNextBilling(items: SubscriptionItem[], today: string): SubscriptionItem[] {
  return [...items].sort((a, b) => {
    const nextA = nextBillingDate(a, today) ?? "9999-12-31";
    const nextB = nextBillingDate(b, today) ?? "9999-12-31";
    if (nextA !== nextB) return nextA.localeCompare(nextB);
    return b.cost.amount - a.cost.amount;
  });
}
