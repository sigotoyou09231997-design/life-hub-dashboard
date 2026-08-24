import type { Handler } from "@netlify/functions";

/**
 * 旅行の「行きたい場所」をつなぐ1区間について、徒歩・公共交通機関・車それぞれの
 * 所要時間と距離(取れれば運賃も)を返す。Google Routes API の computeRoutes を
 * サーバー側から呼ぶ — APIキーをブラウザに出さないためで、キーが漏れると他人に
 * 使われて課金が増えてしまう。
 *
 * GOOGLE_MAPS_API_KEY が設定されていない場合は configured:false を返すだけで、
 * エラーにはしない。キーを用意していない状態でも旅行のルート画面は今までどおり
 * (地図とGoogleマップへのリンクだけで)動く、という前提の作りにしてある。
 *
 * 使うのは基本機能のみ(渋滞考慮や有料道路料金といった追加の計算は要求しない) —
 * それらは上位のSKUとして課金単価が上がるため。基本機能だけなら Essentials SKU で、
 * 月10,000リクエストまで無料。
 */

const ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

export type RouteMode = "walking" | "transit" | "driving";

/** このアプリ側の呼び名 → Routes API の travelMode。 */
const TRAVEL_MODE: Record<RouteMode, string> = {
  walking: "WALK",
  transit: "TRANSIT",
  driving: "DRIVE",
};

const MODES: RouteMode[] = ["walking", "transit", "driving"];

export interface RouteLegInfo {
  durationSeconds?: number;
  distanceMeters?: number;
  /** 運賃。Routes APIは「全区間の運賃データが揃っている経路」でしか返さないので、
   * 日本の路線では返らないことがある。その場合は undefined のまま。 */
  fare?: { currency: string; amount: number };
  /** 経路そのものが返らなかった(その手段では行けない・遠すぎる等)。 */
  unavailable?: boolean;
}

export interface RouteInfoResponse {
  configured: boolean;
  modes?: Record<RouteMode, RouteLegInfo>;
  /** キーはあるが呼び出しに失敗した時だけ入る(画面に出して原因を分かるようにする)。 */
  error?: string;
}

interface RouteInfoBody {
  origin?: string;
  destination?: string;
}

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** 「35.681236,139.767125」のような座標文字列と、住所・施設名を見分ける。
 * 現在地はブラウザのGeolocationから座標で渡ってくる(src/lib/googleMaps.tsのcoordsQuery)。 */
export function toWaypoint(value: string): Record<string, unknown> {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (match) {
    return { location: { latLng: { latitude: Number(match[1]), longitude: Number(match[2]) } } };
  }
  return { address: value.trim() };
}

/** Routes APIの Money(currencyCode/units/nanos) を円などの数値にする。
 * unitsは64bit整数なので文字列で来る。 */
export function parseMoney(money: unknown): { currency: string; amount: number } | undefined {
  if (!money || typeof money !== "object") return undefined;
  const { currencyCode, units, nanos } = money as { currencyCode?: string; units?: string | number; nanos?: number };
  if (!currencyCode) return undefined;
  const whole = typeof units === "string" ? Number(units) : (units ?? 0);
  if (!Number.isFinite(whole)) return undefined;
  return { currency: currencyCode, amount: whole + (nanos ?? 0) / 1_000_000_000 };
}

/** "1234s" 形式の duration を秒に直す。 */
export function parseDuration(duration: unknown): number | undefined {
  if (typeof duration !== "string") return undefined;
  const seconds = Number(duration.replace(/s$/, ""));
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** computeRoutes のレスポンス1件分を、この関数が返す形に直す。経路が1件も無い
 * (その手段では行けない)場合は unavailable にする。 */
export function parseRoutesResponse(data: unknown): RouteLegInfo {
  const routes = (data as { routes?: unknown[] } | null)?.routes;
  if (!Array.isArray(routes) || routes.length === 0) return { unavailable: true };
  const route = routes[0] as {
    duration?: unknown;
    distanceMeters?: unknown;
    travelAdvisory?: { transitFare?: unknown };
  };
  return {
    durationSeconds: parseDuration(route.duration),
    distanceMeters: typeof route.distanceMeters === "number" ? route.distanceMeters : undefined,
    fare: parseMoney(route.travelAdvisory?.transitFare),
  };
}

/** 1手段ぶんの問い合わせ。運賃は公共交通機関にしか無いので、フィールドマスクも
 * 手段ごとに変える(不要なフィールドを要求すると400になることがある)。 */
async function fetchMode(apiKey: string, origin: string, destination: string, mode: RouteMode): Promise<RouteLegInfo> {
  const fieldMask =
    mode === "transit"
      ? "routes.duration,routes.distanceMeters,routes.travelAdvisory.transitFare"
      : "routes.duration,routes.distanceMeters";
  const res = await fetch(ROUTES_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify({
      origin: toWaypoint(origin),
      destination: toWaypoint(destination),
      travelMode: TRAVEL_MODE[mode],
      languageCode: "ja-JP",
      units: "METRIC",
    }),
  });
  if (!res.ok) {
    // 経路が見つからないだけの失敗(その手段では行けない区間)も4xxで返ってくるため、
    // 手段ごとの「出せませんでした」として扱い、他の手段の結果は活かす。
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
  return parseRoutesResponse(await res.json());
}

const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    // キー未設定は異常ではなく「この機能をまだ有効にしていない」状態。
    return jsonResponse(200, { configured: false } satisfies RouteInfoResponse);
  }

  let payload: RouteInfoBody;
  try {
    payload = JSON.parse(event.body ?? "{}") as RouteInfoBody;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }
  const origin = payload.origin?.trim();
  const destination = payload.destination?.trim();
  if (!origin || !destination) return jsonResponse(400, { error: "origin and destination are required" });

  const results = await Promise.all(
    MODES.map(async (mode) => {
      try {
        return [mode, await fetchMode(apiKey, origin, destination, mode)] as const;
      } catch (err) {
        console.error(`[routeInfo] ${mode} failed:`, err instanceof Error ? err.message : err);
        return [mode, { unavailable: true }] as const;
      }
    }),
  );

  const modes = Object.fromEntries(results) as Record<RouteMode, RouteLegInfo>;
  return jsonResponse(200, { configured: true, modes } satisfies RouteInfoResponse);
};

export { handler };
