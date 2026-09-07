/**
 * ホーム（PC幅）の「今週これから」— 明日から数日ぶんの予定を、日付ごとにまとめる。
 *
 * ホームの「次の予定」は今日ぶんしか出さないので、PC幅では画面の下半分が空いていた
 * （2026-09-07、本人の指示「TOPページのPC時が寂しいから、情報量多くしたい」）。
 * 今日は上のカードに出ているので、ここは**明日から**を受け持つ。
 *
 * またがる予定・繰り返し予定の扱いは src/lib/eventSpan.ts に任せる（occursOn）。
 * 「その日にかかっているか」を自前で書くと、繰り返しの追加をここだけ直し漏れる。
 */
import { addDays, parseISO } from "date-fns";
import { toDateStr } from "./date";
import { occursOn, spanDayIndex, type TimedSpan } from "./eventSpan";

export interface WeekAheadDay<T> {
  /** YYYY-MM-DD */
  date: string;
  /** その日にかかっている予定。時刻順（終日と、またがる予定の2日目以降が先）。 */
  items: T[];
}

/** fromDate の**翌日**から days 日ぶんの日付を並べる。今日は含めない。 */
export function weekAheadDates(fromDate: string, days: number): string[] {
  if (days <= 0) return [];
  const start = parseISO(fromDate);
  return Array.from({ length: days }, (_, i) => toDateStr(addDays(start, i + 1)));
}

/**
 * 並び順に使う時刻。
 *
 * 終日と、またがる予定の2日目以降は空文字にして先頭へ置く（ホームの「次の予定」と
 * 同じ扱い）。またがる予定の開始時刻は初日にしか意味が無く、2日目以降もその時刻で
 * 並べると、泊まっている最中の宿泊が毎朝「10:00の予定」として割り込んでくる。
 */
function sortTime(item: TimedSpan, date: string): string {
  if (item.allDay) return "";
  if (spanDayIndex(item, date) !== 1) return "";
  return item.startTime ?? "";
}

/** 日付ごとに、その日にかかっている予定を時刻順で並べる。 */
export function groupWeekAhead<T extends TimedSpan>(items: T[], dates: string[]): WeekAheadDay<T>[] {
  return dates.map((date) => ({
    date,
    items: items
      .filter((item) => occursOn(item, date))
      .sort((a, b) => sortTime(a, date).localeCompare(sortTime(b, date))),
  }));
}

/** 「今週これから」に1件でも出るものがあるか（0件ならカードごと出さない）。 */
export function hasWeekAheadItems<T>(days: WeekAheadDay<T>[]): boolean {
  return days.some((day) => day.items.length > 0);
}
