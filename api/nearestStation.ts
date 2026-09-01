import { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * 旅行の「行きたい場所」1件について、いちばん近い駅と、そこからの徒歩時間を返す。
 *
 * Google の Places API (New) と Routes API をサーバー側から呼ぶ — APIキーを
 * ブラウザに出さないため(api/routeInfo.ts と同じ理由)。
 *
 * Vercel向けの入り口。このリポジトリはNetlifyとVercelの両方に配信されており、
 * サーバー関数は netlify/functions/ と api/ に別々に置く決まり。判断のロジックは
 * netlify/functions/nearestStation.ts と同じものを写してある(片方だけ直して
 * 食い違わないよう、netlify/__tests__/nearestStation.test.ts で突き合わせている)。
 *
 * GOOGLE_MAPS_API_KEY が無い/Places API が有効でない場合は configured:false を
 * 返すだけにする。駅の行が出なくなるだけで、ルート画面そのものは今までどおり動く。
 *
 * 呼び出しは1つの場所につき最大3回(場所の座標 → 近くの駅 → 徒歩の所要時間)。
 * 同じ場所を何度も引かないよう、結果は呼び出し側で覚えておく(src/lib/nearestStation.ts)。
 */

const TEXT_SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const NEARBY_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
const ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

/** 駅として扱う種類。バス停は含めない — 「駅から何分」で知りたいのは鉄道の駅のため。 */
const STATION_TYPES = ["train_station", "subway_station", "light_rail_station"];

/** 駅を探す範囲。これより遠いと「駅から歩く」話ではなくなる(車や送迎の距離)。 */
const SEARCH_RADIUS_METERS = 3000;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface NearestStationResponse {
  configured: boolean;
  /** 見つかった駅。範囲内に駅が無ければ入らない。 */
  station?: { name: string; address?: string };
  /** 駅からその場所までの徒歩。経路が出せなければ入らない。 */
  walk?: { durationSeconds?: number; distanceMeters?: number };
  /** キーはあるが呼び出しに失敗した時だけ入る(画面に出して原因を分かるようにする)。 */
  error?: string;
}

function jsonResponse(res: VercelResponse, statusCode: number, body: unknown) {
  res.status(statusCode).json(body);
}

/** 「35.681236,139.767125」のような座標文字列。現在地から起こした場所はこの形で入る。 */
export function parseLatLng(value: string): LatLng | undefined {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return undefined;
  return { latitude: Number(match[1]), longitude: Number(match[2]) };
}

/** searchText の応答から、最初の1件の座標を取り出す。 */
export function readPlaceLocation(data: unknown): LatLng | undefined {
  const places = (data as { places?: unknown[] } | null)?.places;
  if (!Array.isArray(places) || places.length === 0) return undefined;
  const location = (places[0] as { location?: { latitude?: unknown; longitude?: unknown } }).location;
  if (typeof location?.latitude !== "number" || typeof location?.longitude !== "number") return undefined;
  return { latitude: location.latitude, longitude: location.longitude };
}

/** searchNearby の応答から、いちばん近い駅を取り出す。 */
export function readNearestStation(
  data: unknown,
): { name: string; address?: string; location?: LatLng } | undefined {
  const places = (data as { places?: unknown[] } | null)?.places;
  if (!Array.isArray(places) || places.length === 0) return undefined;
  const place = places[0] as {
    displayName?: { text?: unknown };
    formattedAddress?: unknown;
    location?: { latitude?: unknown; longitude?: unknown };
  };
  const name = typeof place.displayName?.text === "string" ? place.displayName.text.trim() : "";
  if (!name) return undefined;
  const location =
    typeof place.location?.latitude === "number" && typeof place.location?.longitude === "number"
      ? { latitude: place.location.latitude, longitude: place.location.longitude }
      : undefined;
  return {
    name,
    address: typeof place.formattedAddress === "string" ? place.formattedAddress : undefined,
    location,
  };
}

/** "1234s" 形式の duration を秒に直す(routeInfo.ts と同じ)。 */
export function parseDuration(duration: unknown): number | undefined {
  if (typeof duration !== "string") return undefined;
  const seconds = Number(duration.replace(/s$/, ""));
  return Number.isFinite(seconds) ? seconds : undefined;
}

export function readWalk(data: unknown): { durationSeconds?: number; distanceMeters?: number } | undefined {
  const routes = (data as { routes?: unknown[] } | null)?.routes;
  if (!Array.isArray(routes) || routes.length === 0) return undefined;
  const route = routes[0] as { duration?: unknown; distanceMeters?: unknown };
  return {
    durationSeconds: parseDuration(route.duration),
    distanceMeters: typeof route.distanceMeters === "number" ? route.distanceMeters : undefined,
  };
}

async function postJson(url: string, apiKey: string, fieldMask: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

export default async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== "POST") return jsonResponse(res, 405, { error: "Method not allowed" });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return jsonResponse(res, 200, { configured: false } satisfies NearestStationResponse);

  const payload = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {})) as {
    address?: string;
  };
  const address = payload.address?.trim();
  if (!address) return jsonResponse(res, 400, { error: "address is required" });

  try {
    // 1. 住所・施設名を座標にする。座標で入っている場所(現在地から起こした分)はそのまま使う。
    const known = parseLatLng(address);
    const location =
      known ??
      readPlaceLocation(
        await postJson(TEXT_SEARCH_ENDPOINT, apiKey, "places.location", {
          textQuery: address,
          languageCode: "ja",
          maxResultCount: 1,
        }),
      );
    if (!location) return jsonResponse(res, 200, { configured: true } satisfies NearestStationResponse);

    // 2. その周りでいちばん近い駅。
    const station = readNearestStation(
      await postJson(NEARBY_ENDPOINT, apiKey, "places.displayName,places.formattedAddress,places.location", {
        includedPrimaryTypes: STATION_TYPES,
        maxResultCount: 1,
        rankPreference: "DISTANCE",
        languageCode: "ja",
        locationRestriction: { circle: { center: location, radius: SEARCH_RADIUS_METERS } },
      }),
    );
    if (!station) return jsonResponse(res, 200, { configured: true } satisfies NearestStationResponse);

    // 3. 駅からその場所までの徒歩。駅の座標が取れなかった時は名前で問い合わせる。
    const walk = readWalk(
      await postJson(ROUTES_ENDPOINT, apiKey, "routes.duration,routes.distanceMeters", {
        origin: station.location ? { location: { latLng: station.location } } : { address: station.name },
        destination: { location: { latLng: location } },
        travelMode: "WALK",
        languageCode: "ja-JP",
        units: "METRIC",
      }),
    );

    return jsonResponse(res, 200, {
      configured: true,
      station: { name: station.name, address: station.address },
      walk,
    } satisfies NearestStationResponse);
  } catch (error) {
    // 駅が出せなくてもルート画面は動くので、失敗は理由だけ返して静かに畳ませる。
    return jsonResponse(res, 200, {
      configured: true,
      error: error instanceof Error ? error.message : String(error),
    } satisfies NearestStationResponse);
  }
};
