import type { TripRoutePlace, TripScheduleItem, TripScheduleType } from "../types";
import { routeKey } from "./mailPlanImport";
import { orderSchedule } from "./scheduleOrder";
import { mapQueryFor } from "./scheduleDetails";

/**
 * 日程に入っているのに、ルートにはまだ無い場所。
 *
 * 日程とルートは同じ出来事を別の表から見ているだけなのに、ルートは
 * tripRoutePlaces しか見ていなかった。そのため「1日目に新幹線の予定を入れてある」
 * のにルートの1日目は0件、という食い違いが起きる(2026-08-27の指摘)。
 * ここでその日の予定を拾って、ルートに入れる候補として出す。勝手に足さないのは、
 * ルートは「回る順」を持つ並びで、予定を全部入れると順番の意味が薄れるため。
 */
export interface RouteSuggestion {
  /** 元の日程の行。同じ予定を二度出さないための鍵にも使う。 */
  scheduleId: string;
  date: string;
  startTime?: string;
  /** ルートに入れるときの場所の名前。 */
  name: string;
  /** 地図に渡す文字列。 */
  address: string;
  /** ルートに入れるときのメモ。移動なら「どの列車か」がここに残る。 */
  memo?: string;
  /** 元の予定のタイトル。候補の一覧に出す見出し。 */
  title: string;
  type: TripScheduleType;
}

/**
 * 日程の場所(location)に当たるルートの場所。日程の「場所」を押した時に、ルートのどこへ飛ぶかを決める。
 * 住所か名前が同じもの(大文字小文字・前後の空白は見ない)のうち、同じ日のものを先に選ぶ — 同じ駅に
 * 行きと帰りで2回寄る旅行では、押した日程の日の方へ飛ばないと「違うところに飛んでる」になる。
 */
export function findRoutePlaceFor(places: TripRoutePlace[], location: string, date?: string, mapQuery?: string): TripRoutePlace | undefined {
  // 日程に住所が入っていると、ルートの場所は住所で作られる(mapQueryFor)。場所の名前でも住所でも探す。
  const keys = new Set([routeKey(location), ...(mapQuery ? [routeKey(mapQuery)] : [])]);
  const same = places.filter((place) => keys.has(routeKey(place.address)) || keys.has(routeKey(place.name)));
  return same.find((place) => place.date === date) ?? same[0];
}

/**
 * 場所の入っている日程のうち、まだルートに無いものを候補にする。
 *
 * 移動(新幹線・飛行機)は駅名そのものを場所の名前にして、列車名はメモへ回す —
 * 「東京→新函館北斗 はやぶさ13号」は区間の名前で、地図に置ける場所ではない
 * (メールからの取り込み src/lib/mailPlanImport.ts の toRouteImportRows と同じ扱い)。
 */
export function toRouteSuggestions(schedule: TripScheduleItem[], places: TripRoutePlace[]): RouteSuggestion[] {
  const seen = new Set(places.map((place) => routeKey(place.address)));
  const suggestions: RouteSuggestion[] = [];

  const sorted = orderSchedule(schedule);

  for (const item of sorted) {
    // 地図に渡す文字は、住所が入っていれば住所(mapQueryFor)。まだ場所のままルートに入っている場所も「入っている」と数える
    // (住所を足したあと、同じ場所が候補にまた出ないように。入っているものの住所の直しは、ルートの「日程の住所を反映」)。
    const address = mapQueryFor(item);
    if (!item.id || !address) continue;
    const key = routeKey(address);
    const locationKey = item.location?.trim() ? routeKey(item.location) : key;
    if (seen.has(key) || seen.has(locationKey)) continue;
    seen.add(key);
    seen.add(locationKey);

    const isTransport = item.type === "transport";
    suggestions.push({
      scheduleId: item.id,
      date: item.date,
      startTime: item.startTime,
      name: isTransport ? (item.location?.trim() || address) : item.title.trim(),
      address,
      memo: isTransport ? item.title.trim() : item.memo?.trim() || undefined,
      title: item.title.trim(),
      type: item.type,
    });
  }

  return suggestions;
}
