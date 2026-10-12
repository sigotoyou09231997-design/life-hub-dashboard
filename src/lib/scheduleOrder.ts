import type { TripScheduleItem } from "../types";
import { moveTo } from "./packingOrder";

/**
 * 旅行の予定の並び(1日ぶん)。ふだんは時刻の順。日程で並べ替えた日は、その順が勝つ。
 *
 * 2026-10-11、要望の受信箱「予定で日時が被る時どっちを上に持ってくるか選べるといい」から、最初は同じ時刻の
 * 予定どうしだけ入れ替えられるようにした。本人「単純に上下を入れ替えるのが欲しいだけで、同じ予定が入って
 * なくても変えたい」「全部に上下の入れ替えるボタンがある感じ」で、時刻に関係なく入れ替えられるようにした。
 * 2026-10-12 から、入れ替えは行ごとの「↑」「↓」ではなく、持ち物と同じ長押しで動かす形
 * (20件ある日に矢印が40個並んでうるさかったため)。番号の振り方は変えていない。
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

/**
 * 並んだ予定の from 番目を to 番目へ動かした時に書き直す並び順。その日の予定すべてに 1, 2, 3… を振り直す
 * (番号を持っていない予定が混ざっていても、見えている順のまま残るように)。変わらない予定は返さない。
 * 1つ上・1つ下へ動かすのも、この from → to の一種(以前の「↑」「↓」と同じ番号になる)。
 */
export function moveInDay(ordered: TripScheduleItem[], from: number, to: number): { id: string; sortOrder: number }[] {
  if (from === to || from < 0 || from >= ordered.length || to < 0 || to >= ordered.length) return [];
  return moveTo(ordered, from, to)
    .map((item, i) => ({ item, sortOrder: i + 1 }))
    .filter(({ item, sortOrder }) => item.id && item.sortOrder !== sortOrder)
    .map(({ item, sortOrder }) => ({ id: item.id!, sortOrder }));
}
