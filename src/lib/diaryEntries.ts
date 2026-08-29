import type { DiaryEntry } from "../types";

/** 旅行に紐付かない日記だけを、新しい日が上に来るように並べて返す。
 * 旅行中の日記は旅行の詳細(TripDetailPage)から見るものなので、ここでは外す。
 * tripIdに索引は張っていないので全件から絞る — 日記は件数が少ない。 */
export function selectStandaloneDiaries(entries: DiaryEntry[]): DiaryEntry[] {
  return entries
    .filter((entry) => entry.tripId == null)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}
