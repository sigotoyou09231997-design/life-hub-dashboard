/**
 * 区間ごとの「徒歩・公共交通機関・車それぞれ何分・いくら」を取りに行く側。
 * 実際にGoogleへ問い合わせるのはサーバー側(netlify/functions/routeInfo.ts) —
 * APIキーをブラウザに置かないため。
 *
 * キーが未設定なら configured:false が返る。その時この機能は「無い」ものとして
 * 静かに畳み、地図とGoogleマップへのリンクだけのこれまでの表示に戻す(エラーは出さない)。
 */

export type RouteMode = "walking" | "transit" | "driving";

export interface RouteLegInfo {
  durationSeconds?: number;
  distanceMeters?: number;
  fare?: { currency: string; amount: number };
  unavailable?: boolean;
}

export interface RouteInfoResponse {
  configured: boolean;
  modes?: Record<RouteMode, RouteLegInfo>;
  error?: string;
}

/** 車の「金額」に使う概算の前提。Googleは車の費用を返さないので距離から出す。
 * 画面にもこの前提を書いて、あくまで目安だと分かるようにする。 */
export const FUEL_KM_PER_LITER = 15;
export const FUEL_YEN_PER_LITER = 175;
export const FUEL_ASSUMPTION_LABEL = `燃費${FUEL_KM_PER_LITER}km/L・ガソリン${FUEL_YEN_PER_LITER}円/Lで計算`;

export function estimateFuelCostYen(distanceMeters: number): number {
  const liters = distanceMeters / 1000 / FUEL_KM_PER_LITER;
  return Math.round(liters * FUEL_YEN_PER_LITER);
}

export function formatDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds / 60));
  if (total < 60) return `${total}分`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0 ? `${hours}時間` : `${hours}時間${minutes}分`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)}km`;
}

export function formatMoney(money: { currency: string; amount: number }): string {
  const rounded = Math.round(money.amount);
  return money.currency === "JPY" ? `${rounded.toLocaleString("ja-JP")}円` : `${money.currency} ${rounded.toLocaleString("ja-JP")}`;
}

/** 飛行機を出し始める距離。Googleマップ本体も、短い区間では飛行機のタブを出さない。
 * 距離が分からない場合(APIキー未設定など)は出す — 出すぎるより、長距離の時に
 * 選択肢が無い方が困るため。 */
export const FLIGHT_MIN_DISTANCE_METERS = 100_000;

export function shouldOfferFlight(distanceMeters: number | undefined): boolean {
  return distanceMeters == null || distanceMeters >= FLIGHT_MIN_DISTANCE_METERS;
}

/** 区間ごとの結果は動かない(場所を変えない限り同じ)ので、同じ組み合わせは
 * 一度取ったら使い回す。無料枠の消費と待ち時間の両方を減らすため。 */
const cache = new Map<string, Promise<RouteInfoResponse>>();

/** キー未設定と分かったら、以降その画面が閉じるまで問い合わせ自体をやめる。 */
let disabledForSession = false;

/** 現在地は毎回わずかに違う座標で渡ってくる(GPSは静止していても数mは揺れる)。
 * そのまま扱うと同じ場所なのに毎回問い合わせが増えるので、約100m単位に丸めて
 * 同じ地点として扱う。住所や施設名はそのまま。 */
export function normalizeQuery(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return trimmed;
  return `${Number(match[1]).toFixed(3)},${Number(match[2]).toFixed(3)}`;
}

function cacheKey(origin: string, destination: string): string {
  return `${normalizeQuery(origin)}→${normalizeQuery(destination)}`;
}

export async function fetchRouteInfo(origin: string, destination: string): Promise<RouteInfoResponse> {
  if (disabledForSession) return { configured: false };
  if (!origin.trim() || !destination.trim()) return { configured: false };

  const key = cacheKey(origin, destination);
  const cached = cache.get(key);
  if (cached) return cached;

  const request = (async (): Promise<RouteInfoResponse> => {
    const res = await fetch("/api/routeInfo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin: normalizeQuery(origin), destination: normalizeQuery(destination) }),
    });
    if (!res.ok) throw new Error(`routeInfo failed (${res.status})`);
    const data = (await res.json()) as RouteInfoResponse;
    if (!data.configured) disabledForSession = true;
    return data;
  })().catch((error) => {
    // 失敗はこの機能を畳むだけにする — 経路の地図もGoogleマップのリンクも別に出ており、
    // 時間と金額が出ないこと自体でルート画面が使えなくなるわけではない。
    console.error("[routeInfo] failed to fetch route info:", error);
    cache.delete(key);
    return { configured: false } satisfies RouteInfoResponse;
  });

  cache.set(key, request);
  return request;
}

/** テスト用(モジュール内のキャッシュとセッションの無効化フラグを消す)。 */
export function resetRouteInfoCache(): void {
  cache.clear();
  disabledForSession = false;
}
