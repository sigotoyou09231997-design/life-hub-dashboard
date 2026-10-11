import type { TripScheduleItem } from "../types";

/**
 * 旅行の予定の並び。時刻の順に並べ、開始時刻が同じ予定どうしは sortOrder(supabase/sql/031)の順。
 * 2026-10-11、要望の受信箱「予定で日時が被る時どっちを上に持ってくるか選べるといい」と、本人「明らかに
 * ホテル出発が先なのに、その上に乗船場所みたいなのが来てる」から。sortOrder の無い予定は、これまで
 * どおり先に入れた方が上(並べ替えたことのある予定の後ろ)。
 *
 * 日付は見ない(1日ぶんを並べる所でも、旅行全体を並べる所でも使えるように、日付は呼ぶ側で先に比べる)。
 */
export function compareScheduleTime(a: TripScheduleItem, b: TripScheduleItem): number {
  return (
    (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
    (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
    a.createdAt - b.createdAt
  );
}

/** 日付 → 時刻 → 同じ時刻の中の並び。 */
export function compareScheduleDateTime(a: TripScheduleItem, b: TripScheduleItem): number {
  return a.date.localeCompare(b.date) || compareScheduleTime(a, b);
}

/** 並んだ予定のうち、すぐ上(dir=-1)・すぐ下(dir=1)が同じ開始時刻なら、入れ替えられる。 */
export function canSwapWithinTime(ordered: TripScheduleItem[], index: number, dir: -1 | 1): boolean {
  const other = ordered[index + dir];
  return Boolean(other) && (other.startTime ?? "") === (ordered[index].startTime ?? "");
}

/**
 * 同じ開始時刻の予定のうち、index の予定を1つ上か下へ動かした時に書き直す並び順。
 * 同じ時刻のまとまり全体に 1, 2, 3… を振り直す(番号を持っていない予定が混ざっていても順が崩れないように)。
 * 変わらない予定は返さない。
 */
export function swapWithinTime(ordered: TripScheduleItem[], index: number, dir: -1 | 1): { id: string; sortOrder: number }[] {
  if (!canSwapWithinTime(ordered, index, dir)) return [];
  const time = ordered[index].startTime ?? "";
  const group = ordered.filter((item) => (item.startTime ?? "") === time);
  const at = group.indexOf(ordered[index]);
  const moved = [...group];
  [moved[at], moved[at + dir]] = [moved[at + dir], moved[at]];
  return moved
    .map((item, i) => ({ item, sortOrder: i + 1 }))
    .filter(({ item, sortOrder }) => item.id && item.sortOrder !== sortOrder)
    .map(({ item, sortOrder }) => ({ id: item.id!, sortOrder }));
}
