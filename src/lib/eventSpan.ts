import { addDays, differenceInCalendarDays, isValid, parseISO } from "date-fns";
import { formatShortDate, toDateStr, tripDayList } from "./date";

/**
 * 「開始日〜終了日」にまたがる予定のための、日付だけの共通部分。
 *
 * 予定(CalendarEvent)も旅行の日程(TripScheduleItem)も、1日で終わるものは date だけを
 * 持ち、何日かにまたがるものだけ endDate を足す形にしてある。endDate が無い＝1日で
 * 終わる、という読み方は今までのデータにもそのまま当てはまるので、古い行を書き換え
 * なくてよい(宿泊のように「27日から29日まで」と書きたいものだけが新しい形になる)。
 *
 * 一覧やカレンダーは「その日にかかっているか」を何度も聞くので、その判定はここに
 * まとめてある。画面ごとに date === today と書いていくと、またぐ予定を足した時に
 * 直し漏れた画面だけ初日にしか出なくなる。
 */
export interface DateSpan {
  /** 開始日。YYYY-MM-DD。 */
  date: string;
  /** 終了日(その日を含む)。1日で終わるものには無い。YYYY-MM-DD。 */
  endDate?: string;
}

function valid(dateStr: string | undefined): boolean {
  return Boolean(dateStr) && isValid(parseISO(dateStr!));
}

/** 実際の最終日。終了日が無い・壊れている・開始日より前なら、開始日そのもの。 */
export function spanEndDate(span: DateSpan): string {
  if (!valid(span.endDate) || !valid(span.date)) return span.date;
  return span.endDate! > span.date ? span.endDate! : span.date;
}

/**
 * 保存する終了日を決める。開始日と同じ日・それより前・空欄・壊れた日付は、すべて
 * 「1日で終わる」として持たせない — 同じ日を終了日にも入れた行と、終了日を空にした
 * 行が混ざると、同じ見た目の予定が2通りのデータになる。
 */
export function normalizeEndDate(start: string, end: string | undefined): string | undefined {
  if (!valid(start) || !valid(end)) return undefined;
  return end! > start ? end : undefined;
}

/** 何日にまたがるか(1日で終わるものは1)。 */
export function spanDays(span: DateSpan): number {
  if (!valid(span.date)) return 1;
  return differenceInCalendarDays(parseISO(spanEndDate(span)), parseISO(span.date)) + 1;
}

/** 2日以上にまたがるか。 */
export function isMultiDay(span: DateSpan): boolean {
  return spanDays(span) > 1;
}

/** その日にかかっているか(初日・最終日を含む)。 */
export function occursOn(span: DateSpan, date: string): boolean {
  return date >= span.date && date <= spanEndDate(span);
}

/** またがっている日付を全部(初日から最終日まで)。 */
export function spanDates(span: DateSpan): string[] {
  const dates = tripDayList(span.date, spanEndDate(span));
  return dates.length > 0 ? dates : [span.date];
}

/** その日が何日目か(初日が1)。かかっていない日は0。 */
export function spanDayIndex(span: DateSpan, date: string): number {
  if (!occursOn(span, date) || !valid(span.date) || !valid(date)) return 0;
  return differenceInCalendarDays(parseISO(date), parseISO(span.date)) + 1;
}

/**
 * またがる予定にだけ付ける短い但し書き。1日で終わるものは空文字を返すので、
 * 呼ぶ側は「返ってきたら出す」だけでよい。
 *
 * その日を見ている画面(今日・カレンダーの選んだ日)では「2日目/3日」、
 * 日をまたいで並べる一覧では「9/27(日)〜9/29(火)」と、その画面で足りない方を出す。
 */
export function spanLabel(span: DateSpan, onDate?: string): string {
  if (!isMultiDay(span)) return "";
  const total = spanDays(span);
  if (onDate) {
    const index = spanDayIndex(span, onDate);
    if (index > 0) return `${index}日目/${total}日`;
  }
  return `${formatShortDate(span.date)}〜${formatShortDate(spanEndDate(span))}`;
}

/** 期間(start〜end)に少しでもかかっているか。 */
export function overlapsRange(span: DateSpan, start: string, end: string): boolean {
  return span.date <= end && spanEndDate(span) >= start;
}

/** 一覧に並べるための、またがる予定を含んだ「その日の分」の絞り込み。 */
export function occurringOn<T extends DateSpan>(items: T[], date: string): T[] {
  return items.filter((item) => occursOn(item, date));
}

/** カレンダーの点を打つ日付。またがる予定は、かかっている日すべてに点が付く。 */
export function collectSpanDates(items: DateSpan[]): Set<string> {
  const dates = new Set<string>();
  for (const item of items) {
    for (const date of spanDates(item)) dates.add(date);
  }
  return dates;
}

/** 時刻も持つ予定。またがる予定の時刻は、初日の開始時刻と最終日の終了時刻を指す。 */
export interface TimedSpan extends DateSpan {
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
}

/**
 * 一覧の行に出す時刻。
 *
 * またがる予定の「10:00〜13:00」は、初日の10時に始まり最終日の13時に終わる、という
 * 意味しか持たない。その日だけを見ている画面(今日・カレンダーの選んだ日)で3日とも
 * 「10:00〜13:00」と出すと、毎日その時間に何かがあるように読めてしまうので、初日は
 * 「10:00〜」、最終日は「〜13:00」、間の日は丸一日として見せる。
 */
export function spanTimeText(item: TimedSpan, onDate?: string): string {
  if (item.allDay) return "終日";

  const multiDayView = isMultiDay(item) && Boolean(onDate);
  if (!multiDayView) {
    if (item.startTime) return `${item.startTime}${item.endTime ? `〜${item.endTime}` : ""}`;
    return isMultiDay(item) ? "終日" : "時刻未設定";
  }

  const index = spanDayIndex(item, onDate!);
  if (index === 1 && item.startTime) return `${item.startTime}〜`;
  if (index === spanDays(item) && item.endTime) return `〜${item.endTime}`;
  return "終日";
}

/**
 * 開始日を動かしたときの、新しい終了日。
 *
 * 3泊の宿泊を1日ずらしたいだけなのに終了日まで入れ直すのは手間で、そのうえ終了日が
 * 開始日より前に取り残されると期間そのものが消える。日数を保ったまま一緒に動かす。
 */
export function shiftEndDate(prevStart: string, nextStart: string, endDate: string): string {
  if (!endDate || !valid(prevStart) || !valid(nextStart) || !valid(endDate)) return endDate;
  const nights = differenceInCalendarDays(parseISO(endDate), parseISO(prevStart));
  return toDateStr(addDays(parseISO(nextStart), nights));
}
