import type { TripScheduleItem } from "../types";

/**
 * 旅行の予定の並び(1日ぶん)。ふだんは時刻の順。日程の「↑」「↓」で入れ替えた日は、その順が勝つ。
 *
 * 2026-10-11、要望の受信箱「予定で日時が被る時どっちを上に持ってくるか選べるといい」から、最初は同じ時刻の
 * 予定どうしだけ入れ替えられるようにした。本人「単純に上下を入れ替えるのが欲しいだけで、同じ予定が入って
 * なくても変えたい」「全部に上下の入れ替えるボタンがある感じ」で、時刻に関係なく入れ替えられるようにした。
 *
 * 入れ替えると、その日の予定すべてに sortOrder(supabase/sql/031)を 1, 2, 3… と振る。sortOrder の無い予定
 * (入れ替えた後に足した予定・時刻を直した予定)は、時刻を見て並びの中へ差し込む — 並びを頭から見ていき、
 * 自分より遅い時刻の予定の手前に入る。
 */
interface Orderable {
  startTime?: string | null;
  sortOrder?: number | null;
  createdAt?: number;
}

function byTime(a: Orderable, b: Orderable): number {
  return (a.startTime ?? "").localeCompare(b.startTime ?? "") || (a.createdAt ?? 0) - (b.createdAt ?? 0);
}

export function orderScheduleDay<T extends Orderable>(items: T[]): T[] {
  const timed = [...items].sort(byTime);
  const placed = timed.filter((item) => item.sortOrder != null).sort((a, b) => a.sortOrder! - b.sortOrder!);
  const loose = timed.filter((item) => item.sortOrder == null);
  const result: T[] = [];
  let i = 0;
  let j = 0;
  while (i < placed.length && j < loose.length) {
    if ((loose[j].startTime ?? "") < (placed[i].startTime ?? "")) result.push(loose[j++]);
    else result.push(placed[i++]);
  }
  return [...result, ...placed.slice(i), ...loose.slice(j)];
}

/** 旅行全体を、日付の順に、日ごとの並びで。 */
export function orderSchedule(items: TripScheduleItem[]): TripScheduleItem[] {
  const dates = [...new Set(items.map((item) => item.date))].sort();
  return dates.flatMap((date) => orderScheduleDay(items.filter((item) => item.date === date)));
}

/** 並んだ予定のうち、index の予定を1つ上(dir=-1)か下(dir=1)へ動かせるか。 */
export function canMove(ordered: unknown[], index: number, dir: -1 | 1): boolean {
  return index + dir >= 0 && index + dir < ordered.length;
}

/**
 * index の予定を1つ上か下へ動かした時に書き直す並び順。その日の予定すべてに 1, 2, 3… を振り直す
 * (番号を持っていない予定が混ざっていても、見えている順のまま残るように)。変わらない予定は返さない。
 */
export function moveInDay(ordered: TripScheduleItem[], index: number, dir: -1 | 1): { id: string; sortOrder: number }[] {
  if (!canMove(ordered, index, dir)) return [];
  const moved = [...ordered];
  [moved[index], moved[index + dir]] = [moved[index + dir], moved[index]];
  return moved
    .map((item, i) => ({ item, sortOrder: i + 1 }))
    .filter(({ item, sortOrder }) => item.id && item.sortOrder !== sortOrder)
    .map(({ item, sortOrder }) => ({ id: item.id!, sortOrder }));
}
