/**
 * カレンダーの「週」表示(PC幅だけ、src/components/calendar/WeekView.tsx)の並べ方。
 *
 * 画面から切り離して、ここで計算だけを持つ。位置・重なり・上の帯の段の割り当ては
 * 見た目では確かめにくい(ずれていても「なんとなく合っている」ように見える)ので、
 * 数字で試せる形にしてある(weekLayout.test.ts)。
 *
 * 「その日にかかっているか」「その回の何日目か」は src/lib/eventSpan.ts に任せる。
 * ここで date === day と書くと、繰り返し・何日かにまたがる予定だけ週表示から消える。
 */
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { toDateStr } from "./date";
import { isMultiDay, occurrenceStartOn, occursOn, type TimedSpan } from "./eventSpan";
import { clockToMinutes, DEFAULT_EVENT_MINUTES } from "./eventTime";

const MINUTES_PER_DAY = 24 * 60;

/**
 * 重なりを決めるときの、いちばん短い長さ(分)。10分の予定も画面では1行ぶんの高さを
 * 取るので、実際の時刻だけで重なりを見ると、すぐ後に始まる予定の上に字が乗ってしまう。
 */
export const MIN_VISUAL_MINUTES = 30;

/** 何も入っていない週に出す時間の幅(時)。朝から夜まで、ふだん予定を入れる範囲。 */
export const DEFAULT_HOUR_RANGE: HourRange = { start: 8, end: 21 };

export interface HourRange {
  /** 上端の時(0〜23)。 */
  start: number;
  /** 下端の時(1〜24)。この時刻ちょうどで枠が終わる。 */
  end: number;
}

/** その日を含む週(月曜はじまり、月表示と同じ)の7日ぶん。 */
export function weekDatesOf(date: string): string[] {
  const monday = startOfWeek(parseISO(date), { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => toDateStr(addDays(monday, i)));
}

/** 「今日から7日」(第8弾 S-2、2026-10-18): 月曜はじまりではなく、その日から7日。週の終わりの日でも先の予定が見える。 */
export function rollingWeekDatesOf(date: string): string[] {
  const start = parseISO(date);
  return Array.from({ length: 7 }, (_, i) => toDateStr(addDays(start, i)));
}

/** 見出しの「2026年10月12日〜18日」。月や年をまたぐ週は、変わる所だけ書き足す。 */
export function weekTitle(weekDates: string[]): string {
  const first = parseISO(weekDates[0]);
  const last = parseISO(weekDates[weekDates.length - 1]);
  const head = format(first, "yyyy年M月d日");
  if (first.getFullYear() !== last.getFullYear()) return `${head}〜${format(last, "yyyy年M月d日")}`;
  if (first.getMonth() !== last.getMonth()) return `${head}〜${format(last, "M月d日")}`;
  return `${head}〜${format(last, "d日")}`;
}

/**
 * 時刻の枠に置く予定か。1日で終わり、終日ではなく、開始時刻がある予定だけ。
 *
 * 何日かにまたがる予定は、時刻があっても上の帯に置く — 宿泊の「15:00〜翌10:00」を
 * 時刻の枠に描くと、2日ぶんの列を縦に貫く棒になって、その間の予定が読めなくなる。
 */
export function isTimedBlock(item: TimedSpan): boolean {
  return !item.allDay && !isMultiDay(item) && clockToMinutes(item.startTime) !== undefined;
}

export interface TimedBlock<T> {
  item: T;
  /** 0時からの分。 */
  start: number;
  /** 0時からの分(start より大きい)。 */
  end: number;
}

/**
 * その日の、時刻の枠に置く予定。終了時刻が無い・開始より前の予定は、入力画面の既定と
 * 同じ1時間の長さで描く(src/lib/eventTime.ts の DEFAULT_EVENT_MINUTES)。
 */
export function timedBlocksOn<T extends TimedSpan>(items: T[], date: string): TimedBlock<T>[] {
  const blocks: TimedBlock<T>[] = [];
  for (const item of items) {
    if (!isTimedBlock(item) || !occursOn(item, date)) continue;
    const start = clockToMinutes(item.startTime)!;
    const written = clockToMinutes(item.endTime);
    const end = written !== undefined && written > start ? written : Math.min(start + DEFAULT_EVENT_MINUTES, MINUTES_PER_DAY);
    blocks.push({ item, start, end: Math.max(end, start + 1) });
  }
  return blocks;
}

export interface PlacedBlock<T> extends TimedBlock<T> {
  /** 横に並べたときの何列目か(0はじまり)。 */
  column: number;
  /** その重なりのまとまりが何列に分かれるか。幅は 1/columns になる。 */
  columns: number;
}

/**
 * 時間の重なる予定を、横に並べる。
 *
 * 重なりでつながっている予定を1つのまとまりにし、その中で空いている左の列から詰める。
 * 列の数はまとまりごとに決める — 1日の中で1か所だけ3件重なっても、ほかの時間の予定まで
 * 3分の1の幅に細らないようにするため。
 */
export function placeOverlapping<T>(blocks: TimedBlock<T>[]): PlacedBlock<T>[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: PlacedBlock<T>[] = [];
  let cluster: PlacedBlock<T>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;

  const closeCluster = () => {
    for (const block of cluster) block.columns = columnEnds.length;
    cluster = [];
    columnEnds = [];
  };

  for (const block of sorted) {
    const visualEnd = Math.max(block.end, block.start + MIN_VISUAL_MINUTES);
    if (block.start >= clusterEnd) closeCluster();
    let column = columnEnds.findIndex((end) => end <= block.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(visualEnd);
    } else {
      columnEnds[column] = visualEnd;
    }
    const entry: PlacedBlock<T> = { ...block, column, columns: 1 };
    cluster.push(entry);
    placed.push(entry);
    clusterEnd = Math.max(clusterEnd, visualEnd);
  }
  closeCluster();
  return placed;
}

/**
 * 時刻の枠の上端と下端(時)。ふだんは DEFAULT_HOUR_RANGE で、そこからはみ出す予定が
 * ある週だけ広げる。0〜24時をいつも出すと、夜中の空いた枠で画面の大半が埋まるため。
 */
export function hourRangeFor(blocks: { start: number; end: number }[], fallback: HourRange = DEFAULT_HOUR_RANGE): HourRange {
  let start = fallback.start;
  let end = fallback.end;
  for (const block of blocks) {
    start = Math.min(start, Math.floor(block.start / 60));
    end = Math.max(end, Math.ceil(Math.max(block.end, block.start + MIN_VISUAL_MINUTES) / 60));
  }
  return { start: Math.max(0, start), end: Math.min(24, Math.max(end, start + 1)) };
}

/** 枠の中での位置。上端からの割合と高さ(どちらも 0〜100 の %)。枠の外にはみ出す分は切る。 */
export function blockBox(start: number, end: number, range: HourRange): { top: number; height: number } {
  const from = range.start * 60;
  const total = (range.end - range.start) * 60;
  const clampedStart = Math.min(Math.max(start, from), from + total);
  const clampedEnd = Math.min(Math.max(end, clampedStart), from + total);
  return {
    top: ((clampedStart - from) / total) * 100,
    height: ((clampedEnd - clampedStart) / total) * 100,
  };
}

export interface StripSegment<T> {
  item: T;
  /** 同じ予定でも回(繰り返し)ごとに別の帯になるので、回の開始日も混ぜた鍵。 */
  key: string;
  /** 週の中で何列目から(0=月曜)。 */
  startCol: number;
  /** 何列目まで(その列を含む)。 */
  endCol: number;
  /** 前の週から続いている(左端を角にして、続きだと分かるようにする)。 */
  continuesBefore: boolean;
  /** 次の週へ続く。 */
  continuesAfter: boolean;
}

/**
 * 上の帯に置く予定(終日・何日かにまたがる・開始時刻が無い)を、その週の中の区間にする。
 *
 * 何日かにまたがる予定は1本の帯にして、かかっている列をまたいで描く。繰り返しの予定は
 * 回ごとに別の帯になる(毎週の2日間の予定なら、週ごとに1本)。
 */
export function stripSegments<T extends TimedSpan>(
  items: T[],
  weekDates: string[],
  keyOf: (item: T, index: number) => string = (_item, index) => String(index),
): StripSegment<T>[] {
  if (weekDates.length === 0) return [];
  const before = toDateStr(addDays(parseISO(weekDates[0]), -1));
  const after = toDateStr(addDays(parseISO(weekDates[weekDates.length - 1]), 1));
  const segments: StripSegment<T>[] = [];

  items.forEach((item, index) => {
    if (isTimedBlock(item)) return;
    // 回の開始日 → その回がかかっている列。同じ週に同じ予定の別の回が2つ入ることもある。
    const byOccurrence = new Map<string, number[]>();
    weekDates.forEach((date, col) => {
      const start = occurrenceStartOn(item, date);
      if (start === undefined) return;
      byOccurrence.set(start, [...(byOccurrence.get(start) ?? []), col]);
    });
    for (const [occurrence, cols] of byOccurrence) {
      const startCol = Math.min(...cols);
      const endCol = Math.max(...cols);
      segments.push({
        item,
        key: `${keyOf(item, index)}-${occurrence}`,
        startCol,
        endCol,
        continuesBefore: startCol === 0 && occurrenceStartOn(item, before) === occurrence,
        continuesAfter: endCol === weekDates.length - 1 && occurrenceStartOn(item, after) === occurrence,
      });
    }
  });
  return segments;
}

export type Laned<S> = S & { lane: number };

/**
 * 上の帯の何段目に置くか。左から順に、空いているいちばん上の段へ入れる。
 * 同じ列から始まる帯は長いものを先に置く — 長い帯が下の段に回ると、短い帯の
 * あいだを縫うように見えて、どこからどこまでかが読みにくくなるため。
 * 同じ長さなら渡された順のまま(呼ぶ側が決めた並び＝時刻順・種類順を崩さない)。
 */
export function assignLanes<S extends { startCol: number; endCol: number }>(segments: S[]): Laned<S>[] {
  const order = segments
    .map((segment, index) => ({ segment, index }))
    .sort(
      (a, b) =>
        a.segment.startCol - b.segment.startCol ||
        b.segment.endCol - b.segment.startCol - (a.segment.endCol - a.segment.startCol) ||
        a.index - b.index,
    );
  const laneEnds: number[] = [];
  return order.map(({ segment }) => {
    let lane = laneEnds.findIndex((end) => end < segment.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(segment.endCol);
    } else {
      laneEnds[lane] = segment.endCol;
    }
    return { ...segment, lane };
  });
}
