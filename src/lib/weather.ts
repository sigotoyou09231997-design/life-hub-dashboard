/**
 * 旅行の行き先・日程に合わせた天気予報。Open-Meteo(https://open-meteo.com/)を使う。
 *
 * APIキーが要らず非商用は無料なので、ブラウザから直に引く — 駅(nearestStation.ts)や
 * 地図と違い、鍵を隠すための netlify/functions を挟む必要が無い。Netlifyの環境変数も
 * 増やさずに済む。
 *
 * 引けるのは今日から16日先まで(Open-Meteoの上限)。それより先の日は予報そのものが
 * 存在しないので、行を出さずに「まだ予報が出ていません」とだけ伝える。
 *
 * 行き先(Trip.destination)は自由文なので、緯度経度に直せないことがある。その時は
 * 天気の欄ごと畳む — 間違った土地の天気を出すより、出さない方がよい。
 */

import { geocodePlace, type GeocodedPlace } from "./geocoding";

export type { GeocodedPlace };

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/** Open-Meteoが一度に返せる日数の上限。 */
export const FORECAST_DAYS = 16;

/** 予報は1日に何度も変わるものではないが、朝と夜で違うくらいには動く。 */
const FORECAST_TTL_MS = 3 * 60 * 60 * 1000;

const FORECAST_CACHE_PREFIX = "lifehub.weatherForecast.v1:";

export interface DailyForecast {
  date: string; // YYYY-MM-DD
  /** WMOの天気コード(describeWeatherで日本語にする)。 */
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  /** 降水確率(%)。返ってこない地点・日もある。 */
  precipitationChance?: number;
}

export type TripWeatherStatus =
  /** 予報が引けた(days が入っている)。 */
  | "ok"
  /** 行き先を緯度経度に直せなかった。天気の欄ごと畳む。 */
  | "unknown-place"
  /** 通信・APIの失敗。次に開いたときに引き直す。 */
  | "failed";

export interface TripWeather {
  status: TripWeatherStatus;
  place?: GeocodedPlace;
  days: DailyForecast[];
}

export type WeatherIconName = "sun" | "cloud-sun" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "thunder";

export interface WeatherLook {
  label: string;
  icon: WeatherIconName;
}

/** WMO 4677 の天気コード→日本語。Open-Meteoが返すのはこの体系
 * (https://open-meteo.com/en/docs)。知らないコードは「—」に寄せる。 */
const WEATHER_CODES: Record<number, WeatherLook> = {
  0: { label: "快晴", icon: "sun" },
  1: { label: "晴れ", icon: "sun" },
  2: { label: "晴れ時々くもり", icon: "cloud-sun" },
  3: { label: "くもり", icon: "cloud" },
  45: { label: "霧", icon: "fog" },
  48: { label: "霧(着氷)", icon: "fog" },
  51: { label: "弱い霧雨", icon: "drizzle" },
  53: { label: "霧雨", icon: "drizzle" },
  55: { label: "強い霧雨", icon: "drizzle" },
  56: { label: "凍る霧雨", icon: "drizzle" },
  57: { label: "凍る霧雨(強)", icon: "drizzle" },
  61: { label: "弱い雨", icon: "rain" },
  63: { label: "雨", icon: "rain" },
  65: { label: "強い雨", icon: "rain" },
  66: { label: "凍る雨", icon: "rain" },
  67: { label: "凍る雨(強)", icon: "rain" },
  71: { label: "弱い雪", icon: "snow" },
  73: { label: "雪", icon: "snow" },
  75: { label: "強い雪", icon: "snow" },
  77: { label: "霧雪", icon: "snow" },
  80: { label: "にわか雨", icon: "rain" },
  81: { label: "にわか雨(強)", icon: "rain" },
  82: { label: "激しいにわか雨", icon: "rain" },
  85: { label: "にわか雪", icon: "snow" },
  86: { label: "にわか雪(強)", icon: "snow" },
  95: { label: "雷雨", icon: "thunder" },
  96: { label: "雷雨(ひょう)", icon: "thunder" },
  99: { label: "激しい雷雨(ひょう)", icon: "thunder" },
};

const UNKNOWN_WEATHER: WeatherLook = { label: "—", icon: "cloud" };

export function describeWeather(code: number | undefined): WeatherLook {
  if (code == null) return UNKNOWN_WEATHER;
  return WEATHER_CODES[code] ?? UNKNOWN_WEATHER;
}

/** 予報の応答(列ごとの配列)を、1日1件の並びに直す。 */
export function parseForecastResponse(json: unknown): DailyForecast[] {
  const daily = (json as { daily?: Record<string, unknown> } | null)?.daily;
  const dates = daily?.time;
  if (!Array.isArray(dates)) return [];
  const codes = Array.isArray(daily?.weather_code) ? daily.weather_code : [];
  const maxes = Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max : [];
  const mins = Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min : [];
  const rain = Array.isArray(daily?.precipitation_probability_max) ? daily.precipitation_probability_max : [];

  const days: DailyForecast[] = [];
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const tempMax = maxes[i];
    const tempMin = mins[i];
    // 気温が欠けている日は出さない — 「—℃」だけの行は場所を取るだけで何も伝えない。
    if (typeof date !== "string" || typeof tempMax !== "number" || typeof tempMin !== "number") continue;
    const chance = rain[i];
    days.push({
      date,
      weatherCode: typeof codes[i] === "number" ? (codes[i] as number) : -1,
      tempMax: Math.round(tempMax),
      tempMin: Math.round(tempMin),
      precipitationChance: typeof chance === "number" ? Math.round(chance) : undefined,
    });
  }
  return days;
}

/** その日の予報。予報の範囲外(16日より先、または過ぎた日)なら undefined。 */
export function forecastForDate(days: DailyForecast[], date: string): DailyForecast | undefined {
  return days.find((d) => d.date === date);
}

/** 予報が出せる最終日(YYYY-MM-DD)。1件も無ければ undefined。 */
export function forecastHorizon(days: DailyForecast[]): string | undefined {
  return days.length === 0 ? undefined : days[days.length - 1].date;
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

/** 緯度経度は小数2桁(約1km)まで丸めて控えの鍵にする。同じ町なら同じ予報でよい。 */
function forecastCacheKey(place: GeocodedPlace): string {
  return `${FORECAST_CACHE_PREFIX}${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}`;
}

/** 同じ画面の中で同じ行き先を何度も引かないための、その場かぎりの控え。 */
const inFlight = new Map<string, Promise<TripWeather>>();

export async function fetchForecast(place: GeocodedPlace, now: number = Date.now()): Promise<DailyForecast[]> {
  const key = forecastCacheKey(place);
  const cached = readCache<DailyForecast[]>(key, FORECAST_TTL_MS, now);
  if (cached) return cached;

  const params = new URLSearchParams({
    latitude: place.latitude.toFixed(4),
    longitude: place.longitude.toFixed(4),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    // 端末の時間帯に合わせて日付を切ってもらう(旅行先の現地時間で「その日」を出すため)。
    timezone: "auto",
    forecast_days: String(FORECAST_DAYS),
  });
  const res = await fetch(`${FORECAST_ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error(`forecast failed (${res.status})`);
  const days = parseForecastResponse(await res.json());
  if (days.length > 0) writeCache(key, days, now);
  return days;
}

/**
 * 行き先の予報をまとめて引く。失敗しても投げない — 天気は「あれば嬉しい」ものなので、
 * 引けなかったら旅行の画面をそのまま今までどおり出す。
 */
export async function fetchTripWeather(destination: string): Promise<TripWeather> {
  const trimmed = destination.trim();
  if (!trimmed) return { status: "unknown-place", days: [] };

  const running = inFlight.get(trimmed);
  if (running) return running;

  const request = (async (): Promise<TripWeather> => {
    const place = await geocodePlace(trimmed);
    if (!place) return { status: "unknown-place", days: [] };
    const days = await fetchForecast(place);
    return { status: "ok", place, days };
  })().catch((error) => {
    console.error("[weather] failed to fetch:", error);
    return { status: "failed", days: [] } satisfies TripWeather;
  });

  inFlight.set(trimmed, request);
  const result = await request;
  inFlight.delete(trimmed);
  return result;
}

/** テスト用(その場かぎりの控えを消す)。 */
export function resetWeatherCache(): void {
  inFlight.clear();
}
