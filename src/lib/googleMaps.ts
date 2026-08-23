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
export function buildRouteSearchUrl(queries: string[]): string {
  const stops = queries.filter((q) => q.trim());
  if (stops.length === 0) return buildMapSearchUrl("");
  if (stops.length === 1) return buildMapSearchUrl(stops[0]);
  const origin = encodeURIComponent(stops[0]);
  const destination = encodeURIComponent(stops[stops.length - 1]);
  // 区切りの `|` もエスケープしておく(生のパイプはURLとしては不正で、
  // 一部のアプリ内ブラウザがリンクをそこで切る)。Google側は %7C で受け取る。
  const waypoints = stops.slice(1, -1).map((q) => encodeURIComponent(q)).join("%7C");
  const base = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
  return waypoints ? `${base}&waypoints=${waypoints}` : base;
}

/** 隣り合う2地点だけの経路リンク(カードの間の矢印から開く)。 */
export function buildLegSearchUrl(from: string, to: string): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}`;
}
