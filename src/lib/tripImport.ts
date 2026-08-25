import type { Trip, TripScheduleType } from "../types";

/** メールから読み取った日程1件。netlify/functions/extractTripPlan.ts の返す形と揃える。 */
export interface ExtractedTripItem {
  date: string;
  startTime?: string;
  title: string;
  location?: string;
  memo?: string;
  type: TripScheduleType;
}

/** 取り込み画面で1行ごとに持つ状態。読み取った内容はそのまま保存せず、必ず本人が
 * 確認して直せるようにする — AIの読み違いをそのまま日程表に入れないため。 */
export interface TripImportRow extends ExtractedTripItem {
  checked: boolean;
}

export function toImportRows(items: ExtractedTripItem[]): TripImportRow[] {
  return items.map((item) => ({ ...item, checked: true }));
}

/** どの旅行に入れるかの初期値を決める。
 *
 * 読み取った最初の日付を含む旅行があればそれ。無ければ、その日付にいちばん近い旅行。
 * 旅行が1つも無ければ undefined(画面側で「先に旅行を作ってください」と案内する)。
 * 日付から当たりを付けておかないと、旅行が増えるほど毎回選び直すことになる。 */
export function pickDefaultTripId(trips: Trip[], items: ExtractedTripItem[]): string | undefined {
  if (trips.length === 0) return undefined;
  const target = items[0]?.date;
  if (!target) return trips[0].id;

  const covering = trips.find((trip) => trip.startDate <= target && target <= trip.endDate);
  if (covering) return covering.id;

  const nearest = [...trips].sort((a, b) => distanceInDays(a, target) - distanceInDays(b, target))[0];
  return nearest.id;
}

function distanceInDays(trip: Trip, date: string): number {
  const day = Date.parse(`${date}T00:00:00`);
  const start = Date.parse(`${trip.startDate}T00:00:00`);
  const end = Date.parse(`${trip.endDate}T00:00:00`);
  if (day < start) return (start - day) / 86_400_000;
  if (day > end) return (day - end) / 86_400_000;
  return 0;
}

/** 旅行の期間から外れている日程。保存はできるが、日程表の日付タブには出てこないので
 * 気付けるように印を出す(旅行の期間を延ばすか、日付を直してもらう)。 */
export function isOutsideTrip(trip: Trip | undefined, date: string): boolean {
  if (!trip) return false;
  return date < trip.startDate || date > trip.endDate;
}

/** 入れ先を選ぶ一覧の並び。新しい旅行ほど上。
 *
 * 並べ替えをここ(JS側)でやるのは、tripsテーブルに索引が id しか無いため
 * (src/db/schema.ts の TABLE_SCHEMAS)。db.trips.orderBy("startDate") と書くと
 * Dexieが例外を投げ、useLiveQuery 経由で描画時に飛んでメール画面ごと落ちる
 * (2026-08-25 の不具合)。他の画面もすべて toArray() で読んでいる。 */
export function sortTripsForPicker(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => b.startDate.localeCompare(a.startDate));
}
