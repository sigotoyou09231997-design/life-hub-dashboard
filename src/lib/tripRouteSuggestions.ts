import type { TripRoutePlace, TripScheduleItem, TripScheduleType } from "../types";
import { routeKey } from "./mailPlanImport";
import { orderSchedule } from "./scheduleOrder";
import { endMapQueryFor, mapQueryFor } from "./scheduleDetails";

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
  /** 予定に場所も住所も入っておらず、予定の名前で作った候補(2026-10-15)。名前が地図の探し言葉になる。 */
  fromTitle?: boolean;
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
 * titleOnly を付けると、場所も住所も入っていない予定(移動以外)も、予定の名前で作った候補として足す
 * (2026-10-15、要望「日程は入っているのにルートには入っていない予定をルートに入れられるようにしたい」)。
 * 「鶴岡八幡宮」とだけ書いて場所の欄を空にした予定は、これまでルートに入れる道が無かった。
 * 画面の「日程に入っている場所」の一覧だけが使う — 予定を足した時に自動でルートへ入れる側(planRouteAdds)は付けない
 * (「起きる」のような予定まで勝手にルートの場所になってしまうため。入れるかは人が選ぶ)。
 *
 * 移動(新幹線・飛行機)は駅名そのものを場所の名前にして、列車名はメモへ回す —
 * 「東京→新函館北斗 はやぶさ13号」は区間の名前で、地図に置ける場所ではない
 * (メールからの取り込み src/lib/mailPlanImport.ts の toRouteImportRows と同じ扱い)。
 */
export function toRouteSuggestions(
  schedule: TripScheduleItem[],
  places: TripRoutePlace[],
  options: { titleOnly?: boolean } = {},
): RouteSuggestion[] {
  const seen = new Set(places.map((place) => routeKey(place.address)));
  /** 名前だけの候補を出すかどうかの目安。ルートの場所は名前でも、同じ名前の予定がもう入っていると見る。 */
  const seenNames = new Set(places.flatMap((place) => [routeKey(place.address), routeKey(place.name)]));
  const suggestions: RouteSuggestion[] = [];

  const sorted = orderSchedule(schedule);

  for (const item of sorted) {
    // 移動の目的地(2026-10-14)。出発地とは別の場所として、候補にする(同じ場所がもうルートにあれば出さない)。
    // 地図に渡す文字は、目的地の住所があれば住所(2026-10-15)、無ければ目的地の名前。
    const destination = endMapQueryFor(item);
    const destinationName = item.type === "transport" ? item.endLocation?.trim() || destination : undefined;
    // 地図に渡す文字は、住所が入っていれば住所(mapQueryFor)。まだ場所のままルートに入っている場所も「入っている」と数える
    // (住所を足したあと、同じ場所が候補にまた出ないように。入っているものの住所の直しは、ルートの「日程の住所を反映」)。
    const address = mapQueryFor(item);
    const isTransport = item.type === "transport";
    if (item.id && address) {
      const key = routeKey(address);
      const locationKey = item.location?.trim() ? routeKey(item.location) : key;
      if (!seen.has(key) && !seen.has(locationKey)) {
        seen.add(key);
        seen.add(locationKey);
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
    }
    // 場所も住所も無い予定は、予定の名前で候補にする(移動は、区間の名前で地図に置けないので出さない)。
    if (options.titleOnly && item.id && !address && !isTransport) {
      const title = item.title.trim();
      const key = title ? routeKey(title) : "";
      if (key && !seen.has(key) && !seenNames.has(key)) {
        seen.add(key);
        suggestions.push({
          scheduleId: item.id,
          date: item.date,
          startTime: item.startTime,
          name: title,
          address: title,
          memo: item.memo?.trim() || undefined,
          title,
          type: item.type,
          fromTitle: true,
        });
      }
    }
    const destinationNameKey = destinationName ? routeKey(destinationName) : "";
    if (item.id && destination && !seen.has(routeKey(destination)) && !seen.has(destinationNameKey)) {
      seen.add(routeKey(destination));
      if (destinationNameKey) seen.add(destinationNameKey);
      suggestions.push({
        scheduleId: `${item.id}#end`,
        date: item.date,
        startTime: item.endTime ?? item.startTime,
        name: destinationName ?? destination,
        address: destination,
        memo: item.title.trim(),
        title: item.title.trim(),
        type: item.type,
      });
    }
  }

  return suggestions;
}
