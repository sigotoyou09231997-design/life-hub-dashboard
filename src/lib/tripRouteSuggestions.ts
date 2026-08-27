import type { TripRoutePlace, TripScheduleItem, TripScheduleType } from "../types";
import { routeKey } from "./mailPlanImport";

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
 * 場所の入っている日程のうち、まだルートに無いものを候補にする。
 *
 * 移動(新幹線・飛行機)は駅名そのものを場所の名前にして、列車名はメモへ回す —
 * 「東京→新函館北斗 はやぶさ13号」は区間の名前で、地図に置ける場所ではない
 * (メールからの取り込み src/lib/mailPlanImport.ts の toRouteImportRows と同じ扱い)。
 */
export function toRouteSuggestions(schedule: TripScheduleItem[], places: TripRoutePlace[]): RouteSuggestion[] {
  const seen = new Set(places.map((place) => routeKey(place.address)));
  const suggestions: RouteSuggestion[] = [];

  const sorted = [...schedule].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
      a.createdAt - b.createdAt,
  );

  for (const item of sorted) {
    const address = item.location?.trim();
    if (!item.id || !address) continue;
    const key = routeKey(address);
    if (seen.has(key)) continue;
    seen.add(key);

    const isTransport = item.type === "transport";
    suggestions.push({
      scheduleId: item.id,
      date: item.date,
      startTime: item.startTime,
      name: isTransport ? address : item.title.trim(),
      address,
      memo: isTransport ? item.title.trim() : item.memo?.trim() || undefined,
      title: item.title.trim(),
      type: item.type,
    });
  }

  return suggestions;
}
