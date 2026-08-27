import { addDays, addMonths, differenceInCalendarDays, isValid, parseISO } from "date-fns";
import { formatShortDate, toDateStr, tripDayList } from "./date";
import type { RepeatRule } from "../types";

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
  /** 繰り返し(CalendarEventだけが持つ)。持たない型はundefinedのまま単発として扱われる。 */
  repeat?: RepeatRule;
  /** 繰り返しの最終日(その日を含む)。空なら下のMAX_REPEAT_DAYSまでを上限にする。 */
  repeatUntil?: string;
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

/** その日が元の期間(繰り返し前)にかかっているか。occursOn/occurrenceStartOnの土台。 */
function baseOccursOn(span: DateSpan, date: string): boolean {
  return date >= span.date && date <= spanEndDate(span);
}

/** repeatUntilが無い繰り返しをどこまで続けるか(約2年)。無期限に将来の日付すべてを
 * 「かかっている」ことにはしない。 */
const MAX_REPEAT_DAYS = 730;

function repeatHorizon(span: DateSpan): string {
  if (span.repeatUntil && valid(span.repeatUntil) && span.repeatUntil > span.date) return span.repeatUntil;
  return toDateStr(addDays(parseISO(span.date), MAX_REPEAT_DAYS));
}

/**
 * dateがかかっている「回」の開始日。繰り返し予定なら、元の開始日そのものとは限らない
 * (毎週・毎月の先の回の開始日になる)。かかっていなければundefined。
 *
 * occursOn・spanDayIndexは両方ともこれを土台にする — 「その日にかかっているか」と
 * 「その回の中で何日目か」は同じ計算(どの回にあたるか)から素直に出るはずで、別々に
 * 判定すると繰り返しの追加を片方だけ直し漏れる。
 */
export function occurrenceStartOn(span: DateSpan, date: string): string | undefined {
  if (baseOccursOn(span, date)) return span.date;
  if (!span.repeat || span.repeat === "none" || !valid(span.date) || !valid(date)) return undefined;

  const horizon = repeatHorizon(span);
  if (date > horizon) return undefined;

  const start = parseISO(span.date);
  const duration = spanDays(span);
  const daysSinceStart = differenceInCalendarDays(parseISO(date), start);
  if (daysSinceStart <= 0) return undefined; // 開始日より前は繰り返しでは埋めない

  if (span.repeat === "daily") {
    // 毎日ちょうど1回ずつ始まるので、開始日より後はすべて繰り返しの範囲に入る
    // (何日かにまたがる予定を毎日繰り返す、という組み合わせはここでは考慮しない —
    // 単発の日として扱う)。
    return date;
  }

  if (span.repeat === "weekly") {
    const offsetInWeek = daysSinceStart % 7;
    return offsetInWeek < duration ? toDateStr(addDays(start, daysSinceStart - offsetInWeek)) : undefined;
  }

  // monthly: 月の同じ日(短い月は月末に寄る、date-fnsのaddMonthsの挙動)を基準に、
  // dateが収まる回を先頭から順に探す。上限までの月数は多くても数十回なので軽い。
  const maxMonths = Math.ceil(differenceInCalendarDays(parseISO(horizon), start) / 28) + 2;
  for (let n = 1; n <= maxMonths; n++) {
    const occurrenceStart = toDateStr(addMonths(start, n));
    if (occurrenceStart > horizon) break;
    const occurrenceEnd = toDateStr(addDays(addMonths(start, n), duration - 1));
    if (date >= occurrenceStart && date <= occurrenceEnd) return occurrenceStart;
  }
  return undefined;
}

/** その日にかかっているか(初日・最終日を含む)。繰り返し予定は将来の回もここで拾う。 */
export function occursOn(span: DateSpan, date: string): boolean {
  return occurrenceStartOn(span, date) !== undefined;
}

/**
 * fromDate以降で最初にかかる日(繰り返しの次の回を含む)。一覧を「次に来る順」に
 * 並べるためのもの — 繰り返し予定は元の開始日がとっくに過去でも、次の回の日付で
 * 並べたい。見つからなければundefined(その繰り返しはもう終わっている)。
 */
export function nextOccurrenceOnOrAfter(span: DateSpan, fromDate: string): string | undefined {
  if (occursOn(span, fromDate)) return fromDate;
  if (span.date > fromDate) return span.date;
  if (!span.repeat || span.repeat === "none" || !valid(fromDate)) return undefined;
  const horizon = repeatHorizon(span);
  let cursor = fromDate;
  while (cursor <= horizon) {
    if (occursOn(span, cursor)) return cursor;
    cursor = toDateStr(addDays(parseISO(cursor), 1));
  }
  return undefined;
}

/** またがっている日付を全部(初日から最終日まで)。 */
export function spanDates(span: DateSpan): string[] {
  const dates = tripDayList(span.date, spanEndDate(span));
  return dates.length > 0 ? dates : [span.date];
}

/** その日が(繰り返しならその回の中で)何日目か(初日が1)。かかっていない日は0。 */
export function spanDayIndex(span: DateSpan, date: string): number {
  const occurrenceStart = occurrenceStartOn(span, date);
  if (!occurrenceStart || !valid(date)) return 0;
  return differenceInCalendarDays(parseISO(date), parseISO(occurrenceStart)) + 1;
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

/**
 * カレンダーの点を打つ日付、繰り返しの将来の回も含めて。無期限に将来を洗い出すのは
 * 無駄なので、表示中の月の枠(だいたい6週間ぶん)だけに区切って展開する。
 */
export function collectSpanDatesInRange(items: DateSpan[], rangeStart: string, rangeEnd: string): Set<string> {
  const dates = new Set<string>();
  for (const item of items) {
    if (!valid(item.date)) continue;
    let cursor = rangeStart > item.date ? rangeStart : item.date;
    while (cursor <= rangeEnd) {
      if (occursOn(item, cursor)) dates.add(cursor);
      cursor = toDateStr(addDays(parseISO(cursor), 1));
    }
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
