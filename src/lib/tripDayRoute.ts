import type { TripScheduleItem } from "../types";
import { buildRouteSearchUrl, type TravelMode } from "./googleMaps";
import { routeKey } from "./mailPlanImport";

/**
 * 旅行の1日ぶんの日程を、Googleマップの1本の経路(出発地 → 経由地 → 目的地)として開くためのリンク。
 *
 * 経由地を入れて経路になるのは車と徒歩だけ。公共交通機関は、複数の経由地を入れても
 * 「乗換案内を計算できませんでした」になる(2026-10-11に実際に開いて確かめた)ので、
 * ここでは扱わず、区間ごとに見るルートの画面に任せる。
 */
export type DayRouteMode = Extract<TravelMode, "driving" | "walking">;

export interface DayRouteLink {
  url: string;
  /** この1本が始まる場所と終わる場所。分けたときに「どこからどこまで」を見せるため。 */
  from: string;
  to: string;
  /** この1本に含まれる地点の数。 */
  count: number;
}

export interface DayRoute {
  /** その日に回る場所の並び。続けて同じ場所が来るもの(出発→移動など)は1つにまとめてある。 */
  stops: string[];
  /** 1本で開けるぶんずつのリンク。地点が2つ未満なら経路にならないので、空(1つなら場所の検索リンク)。 */
  links: DayRouteLink[];
}

/** Googleマップのリンクが受け付ける経由地の数: パソコンは9つ、スマホのブラウザは3つまで
 * (https://developers.google.com/maps/documentation/urls/get-started)。 */
export const MAX_WAYPOINTS_DESKTOP = 9;
export const MAX_WAYPOINTS_MOBILE = 3;

export function maxWaypointsForDevice(): number {
  const mobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return mobile ? MAX_WAYPOINTS_MOBILE : MAX_WAYPOINTS_DESKTOP;
}

/**
 * その日の場所を、時刻の順に並べる。
 *
 * またがる日程(2泊の宿泊など)は、初日の予定だけを使う — 途中の日にも出すと、チェックインの
 * 時刻に宿が割り込んで、その日の回る順が崩れるため。
 */
export function dayRouteStops(items: TripScheduleItem[], date: string): string[] {
  const places = items
    .filter((item) => item.date === date && item.location?.trim())
    .sort(
      (a, b) =>
        (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.createdAt - b.createdAt,
    )
    .map((item) => item.location!.trim());
  return places.filter((place, index) => index === 0 || routeKey(place) !== routeKey(places[index - 1]));
}

/** 地点の並びを、1本に入る数ごとに区切る。つなぎ目の地点は、前の1本の終点と次の1本の始点の両方に入れる。 */
function chunkStops(stops: string[], maxWaypoints: number): string[][] {
  const perLink = maxWaypoints + 2;
  const chunks: string[][] = [];
  for (let start = 0; start < stops.length - 1; start += perLink - 1) {
    chunks.push(stops.slice(start, start + perLink));
  }
  return chunks;
}

/** 地点の並びを、Googleマップで開くリンクにする。地点が1つなら場所の検索、0なら何も返さない。 */
export function buildRouteLinks(
  stops: string[],
  mode: DayRouteMode,
  maxWaypoints: number = maxWaypointsForDevice(),
): DayRouteLink[] {
  if (stops.length === 0) return [];
  if (stops.length === 1) return [{ url: buildRouteSearchUrl(stops, mode), from: stops[0], to: stops[0], count: 1 }];
  return chunkStops(stops, maxWaypoints).map((chunk) => ({
    url: buildRouteSearchUrl(chunk, mode),
    from: chunk[0],
    to: chunk[chunk.length - 1],
    count: chunk.length,
  }));
}

export function buildDayRoute(
  items: TripScheduleItem[],
  date: string,
  mode: DayRouteMode,
  maxWaypoints: number = maxWaypointsForDevice(),
): DayRoute {
  const stops = dayRouteStops(items, date);
  return { stops, links: buildRouteLinks(stops, mode, maxWaypoints) };
}
