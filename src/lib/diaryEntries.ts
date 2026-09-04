import type { DiaryEntry } from "../types";

/** 旅行に紐付かない日記だけを、新しい日が上に来るように並べて返す。
 * 旅行中の日記は旅行の詳細(TripDetailPage)から見るものなので、ここでは外す。
 * tripIdに索引は張っていないので全件から絞る — 日記は件数が少ない。 */
export function selectStandaloneDiaries(entries: DiaryEntry[]): DiaryEntry[] {
  return entries
    .filter((entry) => entry.tripId == null)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

export interface OnThisDayEntry {
  entry: DiaryEntry;
  /** 何年前の同じ日か。1 なら「1年前の今日」。 */
  yearsAgo: number;
}

/** 去年より前の、同じ月日に書いた日記。近い年から順に返す。
 * 旅行中に書いたものも混ぜる — 振り返りたいのは「その日」であって、
 * 旅行の中か外かではないため。該当が無ければ空(画面には何も出さない)。
 * 2月29日は、うるう年でない年には同じ月日が存在しないので自然と空になる。 */
export function selectOnThisDay(entries: DiaryEntry[], today: string): OnThisDayEntry[] {
  const thisYear = Number(today.slice(0, 4));
  const monthDay = today.slice(5);
  if (!Number.isFinite(thisYear) || monthDay.length !== 5) return [];
  return entries
    .filter((entry) => entry.date.slice(5) === monthDay && Number(entry.date.slice(0, 4)) < thisYear)
    .map((entry) => ({ entry, yearsAgo: thisYear - Number(entry.date.slice(0, 4)) }))
    .sort((a, b) => a.yearsAgo - b.yearsAgo || b.entry.createdAt - a.entry.createdAt);
}
