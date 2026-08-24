/**
 * No API key, no billing. Uses the classic "embed a map" iframe URL format
 * (the same one Google Maps' own "共有 > 地図を埋め込む" produces) rather
 * than the official (keyed) Maps Embed API, plus the documented
 * key-free universal deep link for opening a place in the Maps app/site.
 * If this ever needs to move to the official Maps JavaScript/Places API,
 * this file is the only place that needs to change.
 */

export function buildMapEmbedUrl(query: string): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

export function buildMapSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** 移動手段。キー無しの埋め込みURLでは dirflg、api=1 のリンクでは travelmode で渡す。 */
export type TravelMode = "transit" | "driving" | "walking";

/** 従来型の埋め込みURLが取る移動手段のコード(r=乗換案内, d=車, w=徒歩)。 */
const DIRFLG: Record<TravelMode, string> = { transit: "r", driving: "d", walking: "w" };

/**
 * 複数地点をつないだ経路の埋め込みURL。1地点だけの埋め込み(`?q=`)と同じく
 * キーも課金も要らない、Googleマップ自身が出す従来型の埋め込み形式で、
 * `saddr` と `daddr`(2つ目以降は `+to:` で継ぎ足す)に地点を並べる。
 * 地点が1つしか無ければ経路にならないので、その1点の地図をそのまま返す。
 */
export function buildRouteEmbedUrl(queries: string[]): string {
  const stops = queries.filter((q) => q.trim());
  if (stops.length === 0) return buildMapEmbedUrl("");
  if (stops.length === 1) return buildMapEmbedUrl(stops[0]);
  const [start, ...rest] = stops;
  const daddr = rest.map((q) => encodeURIComponent(q)).join("+to:");
  return `https://maps.google.com/maps?saddr=${encodeURIComponent(start)}&daddr=${daddr}&output=embed`;
}

/**
 * 全地点を渡してGoogleマップ本体(アプリ/サイト)を開く経路リンク。
 * api=1 の公式なdeep linkで、途中の地点は waypoints に `|` 区切りで渡す。
 * 地点が1つなら経路ではなく単なる検索リンクにする。
 */
export function buildRouteSearchUrl(queries: string[], mode: TravelMode = "transit"): string {
  const stops = queries.filter((q) => q.trim());
  if (stops.length === 0) return buildMapSearchUrl("");
  if (stops.length === 1) return buildMapSearchUrl(stops[0]);
  const origin = encodeURIComponent(stops[0]);
  const destination = encodeURIComponent(stops[stops.length - 1]);
  // 区切りの `|` もエスケープしておく(生のパイプはURLとしては不正で、
  // 一部のアプリ内ブラウザがリンクをそこで切る)。Google側は %7C で受け取る。
  const waypoints = stops.slice(1, -1).map((q) => encodeURIComponent(q)).join("%7C");
  const base = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=${mode}`;
  return waypoints ? `${base}&waypoints=${waypoints}` : base;
}

/**
 * 隣り合う2地点だけの経路を、移動手段つきで埋め込む。乗換案内(dirflg=r)にすると
 * 空港や駅を経由する線が地図に出る — キーも課金も要らないのはここまでで、
 * 「何線に乗って何分」という文字はこの埋め込みには含まれない(公式のDirections API
 * が要る)。文字で確かめたいときは下の buildLegSearchUrl でGoogleマップ本体を開く。
 */
export function buildLegEmbedUrl(from: string, to: string, mode: TravelMode): string {
  return `https://maps.google.com/maps?saddr=${encodeURIComponent(from)}&daddr=${encodeURIComponent(to)}&dirflg=${DIRFLG[mode]}&output=embed`;
}

/** 隣り合う2地点だけの経路リンク(その区間をGoogleマップ本体で開く)。 */
export function buildLegSearchUrl(from: string, to: string, mode: TravelMode = "transit"): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=${mode}`;
}

/**
 * 出発地を書かない経路リンク。Googleマップ側が端末の現在地を出発地として
 * 埋めてくれるので、こちらは行き先だけ渡す(アプリ内の埋め込み地図は現在地を
 * 知らないため、そちらへは緯度経度を文字列で渡す — buildLegEmbedUrl参照)。
 */
export function buildFromHereSearchUrl(destination: string, mode: TravelMode = "transit"): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=${mode}`;
}

/**
 * 飛行機だけはGoogleマップの経路(Routes API・埋め込みどちらも)に無い移動手段なので、
 * Googleマップ本体と同じくGoogleフライトの検索へ渡す。
 *
 * 出発地が現在地(緯度,経度)の場合は出発地を書かない — 座標を渡してもGoogleフライトは
 * 空港に解決できないため。書かなければ向こうが現在地から近い空港を出発地に埋めてくれる。
 */
export function buildFlightSearchUrl(origin: string, destination: string): string {
  const isCoords = /^\s*-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?\s*$/.test(origin);
  const query = isCoords || !origin.trim() ? `Flights to ${destination}` : `Flights from ${origin} to ${destination}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}&hl=ja`;
}

/** 埋め込み地図に渡せる「現在地」。Geolocationの結果をそのまま座標文字列にする。 */
export function coordsQuery(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}
