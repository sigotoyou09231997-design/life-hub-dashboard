import type { TripRoutePlace, TripScheduleItem } from "../types";
import { routeKey } from "./mailPlanImport";
import { orderSchedule } from "./scheduleOrder";
import { endMapQueryFor, mapQueryFor } from "./scheduleDetails";
import { planRouteRemoval } from "./tripRouteLinks";

/**
 * 日程の予定ごとに、ルートへ「入れる／入れない」を選ぶ(2026-10-15、要望「日程の予定にルートに反映するかしないか選択するタブ作って」)。
 *
 * これまでは、場所の入っている予定が「日程に入っている場所」の候補に並ぶだけで、予定ごとに「これは入れない」と決める道が無かった
 * (入れない予定も、候補として出続けた)。ここでは全部の予定を並べて、予定ごとの選びを持つ:
 *  - 入れる … 予定の場所がルートに入る(予定の名前しか無い予定は、名前で地図を探す)。
 *  - 入れない … ルートから外し(自分で手を入れた場所は残す)、「日程に入っている場所」の候補にも出さない。
 *  - まだ選んでいない … 今までどおり、候補に出る。
 * 「入れない」の印は、この端末の中に旅行ごとに覚える(連動の入り切り src/lib/routeLink.ts と同じ置き方)。
 */

export type ReflectState =
  /** ルートに入っている。 */
  | "in"
  /** まだ入っていない(選んでもいない)。 */
  | "out"
  /** 「入れない」と選んだ。 */
  | "off"
  /** 地図に置ける場所が無い(場所も住所も無い移動など)。選べない。 */
  | "none";

export interface ReflectRow {
  item: TripScheduleItem;
  state: ReflectState;
  /** 一覧の2行目に出す、ルートに入れる場所の名前(無ければ undefined)。 */
  placeName?: string;
}

const KEY_PREFIX = "lifeHubRouteExcluded:";

/** 「入れない」と選んだ予定の id(この端末・旅行ごと)。 */
export function readExcludedIds(tripId: string): string[] {
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${tripId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** 予定を「入れない」にする/戻す。書き換えたあとの一覧を返す(覚えられない環境でも、返した一覧はこの画面の間は使える)。 */
export function setExcludedId(tripId: string, scheduleId: string, excluded: boolean): string[] {
  const current = readExcludedIds(tripId);
  const next = excluded ? (current.includes(scheduleId) ? current : [...current, scheduleId]) : current.filter((id) => id !== scheduleId);
  try {
    window.localStorage.setItem(`${KEY_PREFIX}${tripId}`, JSON.stringify(next));
  } catch {
    // 覚えられない環境では、この画面を開いている間だけ効く。
  }
  return next;
}

/**
 * その予定が、ルートに作る場所(の鍵)。住所か場所が入っていればそれ(住所が先)、移動は出発地と目的地、
 * 何も入っていない移動以外の予定は、予定の名前。移動で何も無ければ空(地図に置ける場所が無い)。
 * titleOnly は、予定の名前で作る場所かどうか。
 */
function placeKeysFor(item: TripScheduleItem): { keys: string[]; titleOnly: boolean; name?: string } {
  const keys: string[] = [];
  const query = mapQueryFor(item);
  if (query) keys.push(routeKey(query));
  if (item.location?.trim()) keys.push(routeKey(item.location));
  if (item.type === "transport") {
    const end = endMapQueryFor(item);
    if (end) keys.push(routeKey(end));
    if (item.endLocation?.trim()) keys.push(routeKey(item.endLocation));
    return { keys: [...new Set(keys)], titleOnly: false, name: item.location?.trim() || item.endLocation?.trim() || undefined };
  }
  if (keys.length > 0) return { keys: [...new Set(keys)], titleOnly: false, name: item.title.trim() };
  const title = item.title.trim();
  return title ? { keys: [routeKey(title)], titleOnly: true, name: title } : { keys: [], titleOnly: false };
}

/**
 * 日程の全部の予定を、日付と時刻の順に、ルートとの関係つきで並べる。
 * 「入っている」の見方は、候補の出し方(src/lib/tripRouteSuggestions.ts)と同じ — 住所が同じ場所があれば入っている。
 * 予定の名前だけで作る場所は、名前が同じでも入っているとみなす。
 */
export function reflectRows(schedule: TripScheduleItem[], places: TripRoutePlace[], excluded: string[]): ReflectRow[] {
  const addresses = new Set(places.map((place) => routeKey(place.address)));
  const names = new Set(places.map((place) => routeKey(place.name)));
  return orderSchedule(schedule)
    .filter((item) => item.id)
    .map((item) => {
      const { keys, titleOnly, name } = placeKeysFor(item);
      let state: ReflectState;
      if (keys.length === 0) state = "none";
      else if (keys.some((key) => addresses.has(key) || (titleOnly && names.has(key)))) state = "in";
      else if (excluded.includes(item.id!)) state = "off";
      else state = "out";
      return { item, state, placeName: name };
    });
}

/**
 * 「入れない」にした予定から作られた、ルートの場所。外してよいものだけ返す(自分で手を入れた場所は残す):
 * 連動の削除(planRouteRemoval)と同じ決まり — 同じ日・同じ場所で、「行った」でなく、メモも名前も手を入れていない。
 * 予定の名前で作った場所も同じ決まりで見つける。
 */
export function placesToRemoveFor(item: TripScheduleItem, schedule: TripScheduleItem[], places: TripRoutePlace[]): TripRoutePlace[] {
  const others = schedule.filter((other) => other.id !== item.id);
  const removable = planRouteRemoval(item, others, places);
  const { keys, titleOnly } = placeKeysFor(item);
  if (!titleOnly || keys.length === 0) return removable;
  const sameDayTitles = others.filter((other) => other.date === item.date).map((other) => routeKey(other.title));
  for (const place of places) {
    if (!place.id || place.date !== item.date || removable.some((entry) => entry.id === place.id)) continue;
    if (routeKey(place.address) !== keys[0] || routeKey(place.name) !== keys[0]) continue;
    if (sameDayTitles.includes(keys[0])) continue;
    if (place.visited) continue;
    if (place.memo?.trim() && place.memo.trim() !== (item.memo?.trim() || "")) continue;
    removable.push(place);
  }
  return removable;
}

/** その予定から作る場所が、ルートのこの場所に当たるか(外せなかった時に「手を入れてあるので残した」と言うかどうかの判定)。 */
export function reflectCovers(item: TripScheduleItem, place: TripRoutePlace): boolean {
  const { keys } = placeKeysFor(item);
  return keys.includes(routeKey(place.address)) || keys.includes(routeKey(place.name));
}
