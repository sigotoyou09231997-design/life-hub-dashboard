import {
  format,
  startOfMonth,
  endOfMonth,
  getDaysInMonth,
  startOfWeek,
  endOfWeek,
  parseISO,
  isValid,
  addDays,
  addWeeks,
  addMonths,
  eachDayOfInterval,
  differenceInCalendarDays,
  isToday,
  isTomorrow,
  isYesterday,
  isThisYear,
} from "date-fns";
import { ja } from "date-fns/locale";
import type { RepeatRule } from "../types";

export const DATE_FMT = "yyyy-MM-dd";

export function todayStr(): string {
  return format(new Date(), DATE_FMT);
}

export function toDateStr(date: Date): string {
  return format(date, DATE_FMT);
}

export function parseDate(dateStr: string): Date {
  return parseISO(dateStr);
}

export function isValidDateStr(dateStr: string | undefined): boolean {
  if (!dateStr) return false;
  return isValid(parseISO(dateStr));
}

export function monthRange(date: Date = new Date()): { start: string; end: string } {
  return {
    start: toDateStr(startOfMonth(date)),
    end: toDateStr(endOfMonth(date)),
  };
}

export function weekRange(date: Date = new Date()): { start: string; end: string } {
  return {
    start: toDateStr(startOfWeek(date, { weekStartsOn: 1 })),
    end: toDateStr(endOfWeek(date, { weekStartsOn: 1 })),
  };
}

/** Days remaining in the month, including today. */
export function daysLeftInMonth(date: Date = new Date()): number {
  const total = getDaysInMonth(date);
  const dayOfMonth = date.getDate();
  return total - dayOfMonth + 1;
}

export function daysElapsedInMonth(date: Date = new Date()): number {
  return date.getDate();
}

export function formatDisplayDate(dateStr: string): string {
  const d = parseISO(dateStr);
  if (!isValid(d)) return dateStr;
  return format(d, "M月d日(E)", { locale: ja });
}

/** 一覧の行に載せるための短い日付。formatDisplayDate("8月21日(金)")は見出し向けで、
 * バッジのように横幅が限られる場所では長すぎて折り返しの原因になるため、
 * 今日・明日・昨日は言葉に、同年は "M/d(曜)"、それ以外の年だけ年を付ける。 */
export function formatCompactDate(dateStr: string): string {
  const d = parseISO(dateStr);
  if (!isValid(d)) return dateStr;
  if (isToday(d)) return "今日";
  if (isTomorrow(d)) return "明日";
  if (isYesterday(d)) return "昨日";
  if (isThisYear(d)) return format(d, "M/d(E)", { locale: ja });
  return format(d, "yyyy/M/d");
}

export function formatMonthTitle(date: Date): string {
  return format(date, "yyyy年M月");
}

/** Gmail-style timestamp: time for today, "M月d日" within this year, full date otherwise. */
export function formatGmailTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  if (isToday(d)) return format(d, "HH:mm");
  if (isThisYear(d)) return format(d, "M月d日");
  return format(d, "yyyy/M/d");
}

export function advanceByRepeat(dateStr: string, repeat: RepeatRule): string {
  const d = parseISO(dateStr);
  if (!isValid(d)) return dateStr;
  switch (repeat) {
    case "daily":
      return toDateStr(addDays(d, 1));
    case "weekly":
      return toDateStr(addWeeks(d, 1));
    case "monthly":
      return toDateStr(addMonths(d, 1));
    default:
      return dateStr;
  }
}

export function isOverdue(dueDate?: string, dueTime?: string): boolean {
  if (!dueDate) return false;
  const now = new Date();
  const target = parseISO(dueTime ? `${dueDate}T${dueTime}` : `${dueDate}T23:59:59`);
  if (!isValid(target)) return false;
  return target.getTime() < now.getTime();
}

/** Every calendar day from startDate to endDate inclusive, correctly
 * spanning month-end, year-end, and leap-year boundaries. */
export function tripDayList(startDate: string, endDate: string): string[] {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (!isValid(start) || !isValid(end) || end < start) return [];
  return eachDayOfInterval({ start, end }).map(toDateStr);
}

/** "日帰り" for a same-day trip, otherwise "n泊m日". */
export function tripDurationLabel(startDate: string, endDate: string): string {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (!isValid(start) || !isValid(end) || end < start) return "";
  const nights = differenceInCalendarDays(end, start);
  if (nights <= 0) return "日帰り";
  return `${nights}泊${nights + 1}日`;
}

/**
 * 旅行カードの右肩に出す一言。旅行一覧は「今どの旅行が近いか」を最初に答える
 * べき画面なので、日付そのものより残り日数のほうが上に来る。
 *
 *   出発前   … あと3日 / 明日 / 今日から
 *   旅行中   … 2日目
 *   終わった … 空文字(アーカイブ側は日付だけを見せる)
 */
export function tripCountdownLabel(startDate: string, endDate: string, today: string = todayStr()): string {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const now = parseISO(today);
  if (!isValid(start) || !isValid(now)) return "";

  const untilStart = differenceInCalendarDays(start, now);
  if (untilStart > 1) return `あと${untilStart}日`;
  if (untilStart === 1) return "明日から";
  if (untilStart === 0) return "今日から";

  if (isValid(end) && differenceInCalendarDays(end, now) >= 0) {
    return `${differenceInCalendarDays(now, start) + 1}日目`;
  }
  return "";
}
