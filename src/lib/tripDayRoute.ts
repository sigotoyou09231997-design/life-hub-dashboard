import type { TripScheduleItem, TripTransportMode } from "../types";
import { buildRouteSearchUrl, type TravelMode } from "./googleMaps";
import { routeKey } from "./mailPlanImport";
import { orderScheduleDay } from "./scheduleOrder";

/**
 * 旅行の1日ぶんの日程を、Googleマップの経路(出発地 → 経由地 → 目的地)として開くためのリンク。
 *
 * Googleマップの1本の経路は、移動手段を1つしか持てない。区間(場所から場所への移動)ごとに
 * 手段を選べるようにするため、同じ手段が続く区間をまとめて1本にし、手段が変わる所で分ける
 * (buildSegmentLinks)。
 *
 * 経由地を入れて1本の経路になるのは車と徒歩だけ。公共交通機関は、複数の経由地を入れても
 * 「乗換案内を計算できませんでした」になる(2026-10-11に実際に開いて確かめた)ので、
 * 電車・バスの区間は1区間ずつ開く。
 */
export type LegMode = Extract<TravelMode, "driving" | "walking" | "transit">;
/** 経由地をまとめて渡せる手段。 */
export type DayRouteMode = Extract<LegMode, "driving" | "walking">;

export const LEG_MODE_LABEL: Record<LegMode, string> = {
  driving: "車",
  walking: "徒歩",
  transit: "電車・バス",
};

export interface DayRouteLink {
  url: string;
  mode: LegMode;
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
  // 並びは日程と同じ(入れ替えた日はその順)。場所の無い予定も並びには効くので、並べてから絞る。
  const places = orderScheduleDay(items.filter((item) => item.date === date))
    .filter((item) => item.location?.trim())
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
  if (stops.length === 1) return [{ url: buildRouteSearchUrl(stops, mode), mode, from: stops[0], to: stops[0], count: 1 }];
  return chunkStops(stops, maxWaypoints).map((chunk) => ({
    url: buildRouteSearchUrl(chunk, mode),
    mode,
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

/**
 * 区間ごとの手段(legModes[i] は stops[i] → stops[i + 1])で、開くリンクを並べる。
 * 同じ手段が続く区間は1本にまとめ(車・徒歩は経由地の上限ごとにさらに分ける)、
 * 電車・バスは1区間ずつにする。
 */
export function buildSegmentLinks(
  stops: string[],
  legModes: LegMode[],
  maxWaypoints: number = maxWaypointsForDevice(),
): DayRouteLink[] {
  if (stops.length <= 1) return buildRouteLinks(stops, "driving", maxWaypoints);
  const links: DayRouteLink[] = [];
  let start = 0;
  for (let leg = 1; leg <= stops.length - 1; leg++) {
    const mode = legModes[start] ?? "driving";
    const last = leg === stops.length - 1;
    if (!last && (legModes[leg] ?? "driving") === mode) continue;
    const segment = stops.slice(start, leg + 1);
    if (mode === "transit") {
      for (let i = 0; i < segment.length - 1; i++) {
        const pair = [segment[i], segment[i + 1]];
        links.push({ url: buildRouteSearchUrl(pair, "transit"), mode, from: pair[0], to: pair[1], count: 2 });
      }
    } else {
      links.push(...buildRouteLinks(segment, mode, maxWaypoints));
    }
    start = leg;
  }
  return links;
}

/** 区間の手段を端末に覚えるときの鍵。日付と、両端の場所で決める(外す場所を変えても同じ区間は同じ鍵)。 */
export function legKey(date: string, from: string, to: string): string {
  return `${date}|${routeKey(from)}|${routeKey(to)}`;
}

/** 外した場所を覚えるときの鍵。同じ日に同じ場所が2度出る(桂浜 → 海津見神社 → 桂浜)ので、何度目かも入れる。 */
export function stopKeys(date: string, stops: string[]): string[] {
  const seen = new Map<string, number>();
  return stops.map((stop) => {
    const key = routeKey(stop);
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    return `${date}|${key}|${nth}`;
  });
}

/** 予定の移動手段を、Googleマップの経路の手段に読み替える。飛行機・自転車は経路で引けないので無し。 */
export function legModeForTransport(mode: TripTransportMode | undefined): LegMode | undefined {
  switch (mode) {
    case "car":
    case "taxi":
      return "driving";
    case "walk":
      return "walking";
    case "train":
    case "shinkansen":
    case "bus":
    case "ferry":
      return "transit";
    default:
      return undefined;
  }
}

/**
 * その日の移動の予定から、「ここから出る区間は何で行くか」を引く(鍵は出発地の場所)。
 * 移動の予定の「場所」は出発地なので、その場所から次の場所への区間に、その手段を当てる。
 * 本人が区間ごとに選んだ手段があれば、そちらが優先(src/components/trips/TripDayRoute.tsx)。
 */
export function transportHints(items: TripScheduleItem[], date: string): Map<string, LegMode> {
  const hints = new Map<string, LegMode>();
  const transports = orderScheduleDay(items.filter((item) => item.date === date)).filter(
    (item) => item.type === "transport" && item.location?.trim(),
  );
  for (const item of transports) {
    const mode = legModeForTransport(item.transportMode);
    const key = routeKey(item.location!);
    if (mode && !hints.has(key)) hints.set(key, mode);
  }
  return hints;
}

export function hintFor(hints: Map<string, LegMode>, from: string): LegMode | undefined {
  return hints.get(routeKey(from));
}

/**
 * その日の経路の、全体の移動手段(2026-10-14、要望「ルートでは日程で選択された移動手段を基本的に示して欲しい」)。
 * その日の移動の予定が選んでいる手段(src/lib/tripCategories.ts の移動手段)を、経路の手段(車・徒歩・電車バス)に読み替えて、
 * いちばん多いものにする。同数なら、その日に先に出てくる方。経路で引けない手段(飛行機・自転車)・手段を決めていない移動は数えない。
 * 決められなければ undefined(画面は、これまでどおり本人が選んだ手段か、車にする)。
 */
export function dayModeFromTransports(items: TripScheduleItem[], date: string): LegMode | undefined {
  const counts = new Map<LegMode, number>();
  const order: LegMode[] = [];
  for (const item of orderScheduleDay(items.filter((entry) => entry.date === date))) {
    if (item.type !== "transport") continue;
    const mode = legModeForTransport(item.transportMode);
    if (!mode) continue;
    if (!counts.has(mode)) order.push(mode);
    counts.set(mode, (counts.get(mode) ?? 0) + 1);
  }
  let best: LegMode | undefined;
  for (const mode of order) {
    if (best === undefined || (counts.get(mode) ?? 0) > (counts.get(best) ?? 0)) best = mode;
  }
  return best;
}

