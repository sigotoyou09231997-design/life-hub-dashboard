/**
 * 行きたい場所ごとの「いちばん近い駅から徒歩何分か」を取りに行く側。
 * 実際にGoogleへ問い合わせるのはサーバー側(netlify/functions/nearestStation.ts) —
 * APIキーをブラウザに置かないため。
 *
 * キーが未設定(または Places API を有効にしていない)なら configured:false が返る。
 * その時この行は「無い」ものとして静かに畳み、これまでどおりの地図だけの表示に戻す。
 *
 * 結果は場所ごとに変わらないので、いちどきいたら端末に覚えておく。1件につき最大3回
 * 問い合わせるため、開き直すたびに引き直すと無料枠をすぐ使い切ってしまう。
 */

export interface NearestStation {
  name: string;
  address?: string;
}

export interface NearestStationResponse {
  configured: boolean;
  station?: NearestStation;
  walk?: { durationSeconds?: number; distanceMeters?: number };
  error?: string;
}

/** 端末に覚えておく期間。駅も道も滅多に変わらないが、間違った結果を永久に持ち続け
 * ないよう区切っておく。 */
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CACHE_PREFIX = "lifehub.nearestStation.v1:";

interface CachedEntry {
  at: number;
  value: NearestStationResponse;
}

/** 同じ画面の中で同じ場所を何度も引かないための、その場かぎりの控え。 */
const inFlight = new Map<string, Promise<NearestStationResponse>>();

/** キー未設定と分かったら、以降その画面が閉じるまで問い合わせ自体をやめる。 */
let disabledForSession = false;

function cacheKey(address: string): string {
  return `${CACHE_PREFIX}${address.trim()}`;
}

export function readCache(address: string, now: number = Date.now()): NearestStationResponse | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(address));
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CachedEntry;
    if (!entry?.at || now - entry.at > CACHE_TTL_MS) return undefined;
    return entry.value;
  } catch {
    // プライベートモード等で読めなくても、毎回問い合わせるだけで表示は続けられる。
    return undefined;
  }
}

function writeCache(address: string, value: NearestStationResponse, now: number = Date.now()): void {
  try {
    localStorage.setItem(cacheKey(address), JSON.stringify({ at: now, value } satisfies CachedEntry));
  } catch {
    // 同上。覚えられないだけで、その場の表示は効いている。
  }
}

export async function fetchNearestStation(address: string): Promise<NearestStationResponse> {
  const trimmed = address.trim();
  if (!trimmed) return { configured: false };
  if (disabledForSession) return { configured: false };

  const cached = readCache(trimmed);
  if (cached) return cached;

  const running = inFlight.get(trimmed);
  if (running) return running;

  const request = (async (): Promise<NearestStationResponse> => {
    const res = await fetch("/api/nearestStation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: trimmed }),
    });
    if (!res.ok) throw new Error(`nearestStation failed (${res.status})`);
    const data = (await res.json()) as NearestStationResponse;
    if (!data.configured) {
      disabledForSession = true;
      return data;
    }
    // 失敗(error)は覚えない — 一時的な失敗を90日持ち続けることになるため。
    if (!data.error) writeCache(trimmed, data);
    return data;
  })().catch((error) => {
    // 駅の行が出ないだけにする。地図もGoogleマップへのリンクも別に出ている。
    console.error("[nearestStation] failed to fetch:", error);
    return { configured: false } satisfies NearestStationResponse;
  });

  inFlight.set(trimmed, request);
  const result = await request;
  inFlight.delete(trimmed);
  return result;
}

/** 「長谷駅から徒歩7分(600m)」。時間が取れなければ距離だけ、どちらも無ければ駅名だけ。 */
export function describeNearestStation(
  station: NearestStation,
  walk: { durationSeconds?: number; distanceMeters?: number } | undefined,
  format: { duration: (seconds: number) => string; distance: (meters: number) => string },
): string {
  const parts: string[] = [];
  if (walk?.durationSeconds != null) parts.push(`徒歩${format.duration(walk.durationSeconds)}`);
  if (walk?.distanceMeters != null) parts.push(format.distance(walk.distanceMeters));
  if (parts.length === 0) return station.name;
  return `${station.name}から${parts[0]}${parts[1] ? `(${parts[1]})` : ""}`;
}

/** テスト用(その場かぎりの控えと、セッションの無効化フラグを消す)。 */
export function resetNearestStationCache(): void {
  inFlight.clear();
  disabledForSession = false;
}
