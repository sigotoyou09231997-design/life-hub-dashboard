/**
 * 地名 → 緯度経度。Open-Meteo の Geocoding API(https://open-meteo.com/en/docs/geocoding-api)
 * を使う。APIキーが要らず無料なので、ブラウザから直に引ける。
 *
 * 2つの使い方がある:
 *   - geocodePlace … 旅行の行き先1つを黙って緯度経度に直す(天気予報。端末に控える)
 *   - searchPlaces … 本人が打った言葉から候補を並べる(場所リマインドの場所さがし)
 *
 * 元になっているのは GeoNames なので、市区町村・地区のほか駅なども引けるが、
 * 店や番地までは出ない。半径100m〜1kmで使う分には足りる、という前提で置いている。
 */

const GEOCODE_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

/** 地名→緯度経度は変わらないので長めに覚える。 */
const GEOCODE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const GEOCODE_CACHE_PREFIX = "lifehub.weatherPlace.v1:";

export interface GeocodedPlace {
  name: string;
  latitude: number;
  longitude: number;
  /** 「日本」「フランス」など。同じ地名が各国にあるので、何を引いたか見せるために持つ。 */
  country?: string;
  /** 「東京都」「神奈川県」など。候補を並べたときの見分けに使う。 */
  admin1?: string;
}

/**
 * 行き先の自由文から、地名として引ける1語を切り出す。
 *
 * Trip.destination には「京都・大阪」「パリ（フランス）」のように複数・注釈つきで
 * 入ることがある。Open-Meteoの地名検索は1語しか受け取れないので、区切りの手前だけを
 * 渡す。全部渡して0件になるより、先頭の地名で引けた方が役に立つ。
 */
export function destinationQuery(destination: string): string {
  const head = destination.split(/[・、,，/／\s（(]/)[0] ?? "";
  return head.trim();
}

function toPlace(raw: unknown): GeocodedPlace | undefined {
  const item = raw as { name?: unknown; latitude?: unknown; longitude?: unknown; country?: unknown; admin1?: unknown };
  if (typeof item?.latitude !== "number" || typeof item?.longitude !== "number") return undefined;
  return {
    name: typeof item.name === "string" ? item.name : "",
    latitude: item.latitude,
    longitude: item.longitude,
    country: typeof item.country === "string" ? item.country : undefined,
    admin1: typeof item.admin1 === "string" ? item.admin1 : undefined,
  };
}

/** 地名検索の応答を候補の並びに直す。緯度経度の無い行は落とす。 */
export function parseGeocodeResults(json: unknown): GeocodedPlace[] {
  const results = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.map(toPlace).filter((place): place is GeocodedPlace => place !== undefined);
}

function buildUrl(query: string, count: number): string {
  return `${GEOCODE_ENDPOINT}?name=${encodeURIComponent(query)}&count=${count}&language=ja&format=json`;
}

interface CachedEntry<T> {
  at: number;
  value: T;
}

function readCache<T>(key: string, ttlMs: number, now: number): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CachedEntry<T>;
    if (!entry?.at || now - entry.at > ttlMs) return undefined;
    return entry.value;
  } catch {
    // プライベートモード等で読めなくても、毎回引き直すだけで表示は続けられる。
    return undefined;
  }
}

function writeCache<T>(key: string, value: T, now: number): void {
  try {
    localStorage.setItem(key, JSON.stringify({ at: now, value } satisfies CachedEntry<T>));
  } catch {
    // 同上。覚えられないだけで、その場の表示は効いている。
  }
}

/**
 * 行き先1つを緯度経度に直す(天気予報用)。結果は端末に90日覚える。
 * 「引いたが見つからなかった」も覚える — 引き直しても結果は変わらないため。
 */
export async function geocodePlace(destination: string, now: number = Date.now()): Promise<GeocodedPlace | undefined> {
  const query = destinationQuery(destination);
  if (!query) return undefined;

  const key = `${GEOCODE_CACHE_PREFIX}${query}`;
  const cached = readCache<GeocodedPlace | null>(key, GEOCODE_TTL_MS, now);
  if (cached !== undefined) return cached ?? undefined;

  const res = await fetch(buildUrl(query, 1));
  if (!res.ok) throw new Error(`geocode failed (${res.status})`);
  const place = parseGeocodeResults(await res.json())[0];
  writeCache(key, place ?? null, now);
  return place;
}

/**
 * 本人が打った言葉から候補を並べる(場所さがし)。控えは取らない —
 * 打つたびに結果が変わるものなので、覚えても当たらない。
 * 失敗しても投げず、空の並びを返す(場所さがしが空振りするだけにする)。
 */
export async function searchPlaces(query: string, count: number = 5): Promise<GeocodedPlace[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  try {
    const res = await fetch(buildUrl(trimmed, count));
    if (!res.ok) throw new Error(`geocode search failed (${res.status})`);
    return parseGeocodeResults(await res.json());
  } catch (error) {
    console.error("[geocoding] search failed:", error);
    return [];
  }
}

/** 「東京都・日本」。候補を並べたときに、同じ名前のどれなのかを見分けるための行。 */
export function placeSubtitle(place: GeocodedPlace): string {
  return [place.admin1, place.country].filter(Boolean).join("・");
}
