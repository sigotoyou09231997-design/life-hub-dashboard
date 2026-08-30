import { BACKGROUND_CANDIDATES } from "./backgrounds";

/** 旅行の表紙に使える背景写真。屋内カットは「旅先」に見えないので、リゾート・
 * 風景・街・建築だけを対象にする。 */
const COVER_CATEGORIES = new Set(["resort", "landscape", "city", "architecture"]);

const TRIP_COVERS: string[] = BACKGROUND_CANDIDATES.filter((candidate) =>
  COVER_CATEGORIES.has(candidate.category),
).map((candidate) => candidate.src);

const FALLBACK_COVER = "/backgrounds/evening-glass-pavilion-v5.jpg";

/**
 * 旅行カードの表紙を1枚選ぶ。以前は全カードが同じ写真で、一覧に並べても
 * どれがどの旅行か絵で見分けられなかった。行き先の文字列から決定的に選ぶので、
 * 同じ旅行はいつ開いても同じ絵になり、別の旅行とは高い確率で別の絵になる。
 *
 * 2026-08-31: これは「その土地の写真が取れるまで／取れなかった時」に出る写真に
 * なった。実際の旅先の写真は resolveTripCover() が取りに行く。
 */
export function tripCoverImage(seed: string): string {
  if (TRIP_COVERS.length === 0) return FALLBACK_COVER;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TRIP_COVERS[hash % TRIP_COVERS.length];
}

/* ---------------------------------------------------------------------------
   その土地の写真（サーバー関数 netlify/functions/tripCover.ts）

   旅行のタイトルと行き先をサーバーへ渡すと、AIがそこから地名を読み取り
   （例:「神奈川旅行」→「鎌倉」）、Google Places のその場所の写真を1枚返す。
   画像そのものもサーバー経由で受け取る（Google の APIキーをブラウザに出さない）。

   同じ旅行で何度も問い合わせないよう、結果はこの端末の localStorage に持つ。
   見つからなかった時も「見つからなかった」ことを覚える — 覚えないと、写真の無い
   旅行を開くたびに毎回AIとPlacesを呼び出して費用だけがかかる。
   ------------------------------------------------------------------------ */

const CACHE_PREFIX = "tripCover:v1:";
/** 写真が見つかった時に覚えておく時間。 */
export const COVER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 見つからなかった時に覚えておく時間。旅行の名前を直せばキーが変わるので、
 * 「名前を直したのに写真が出ない」は起きない。 */
export const COVER_MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export interface TripCoverEntry {
  /** Places API の写真の識別子。見つからなかった時は null。 */
  photo: string | null;
  attribution?: string;
  /** 覚えた時刻（epoch ms）。 */
  at: number;
}

export interface ResolvedTripCover {
  url: string;
  attribution?: string;
}

/** 旅行1件を表す覚え書きのキー。行き先と名前の両方が効く。 */
export function coverCacheKey(name: string, destination: string): string {
  return `${CACHE_PREFIX}${(destination || "").trim()}|${(name || "").trim()}`;
}

/** 覚え書きがまだ使えるか。 */
export function isFreshCoverEntry(entry: TripCoverEntry, now: number): boolean {
  const ttl = entry.photo ? COVER_CACHE_TTL_MS : COVER_MISS_TTL_MS;
  return now - entry.at < ttl;
}

/** 保存されている文字列を覚え書きに戻す。壊れていれば null（＝聞き直す）。 */
export function parseCoverEntry(raw: string | null): TripCoverEntry | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TripCoverEntry>;
    if (typeof parsed.at !== "number") return null;
    if (parsed.photo !== null && typeof parsed.photo !== "string") return null;
    return {
      photo: parsed.photo ?? null,
      attribution: typeof parsed.attribution === "string" ? parsed.attribution : undefined,
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

/** 写真の識別子から、画像を受け取るURLにする（中継はサーバー関数）。 */
export function tripCoverPhotoUrl(photo: string): string {
  return `/api/tripCover?photo=${encodeURIComponent(photo)}`;
}

function readEntry(key: string): TripCoverEntry | null {
  try {
    const entry = parseCoverEntry(localStorage.getItem(key));
    if (!entry || !isFreshCoverEntry(entry, Date.now())) return null;
    return entry;
  } catch {
    // プライベートブラウズなどで localStorage が使えない端末。覚えないだけで動く。
    return null;
  }
}

function writeEntry(key: string, entry: TripCoverEntry): void {
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // 容量オーバーなど。覚えられなくても表示は続ける。
  }
}

function toResolved(entry: TripCoverEntry): ResolvedTripCover | null {
  return entry.photo ? { url: tripCoverPhotoUrl(entry.photo), attribution: entry.attribution } : null;
}

/**
 * その旅行の土地の写真を1枚見つける。見つからなければ null（呼び出し側は
 * tripCoverImage() の同梱写真のままにする）。
 */
export async function resolveTripCover(name: string, destination: string): Promise<ResolvedTripCover | null> {
  if (!name && !destination) return null;
  const key = coverCacheKey(name, destination);
  const cached = readEntry(key);
  if (cached) return toResolved(cached);
  // 圏外で開いた時に、毎回失敗する問い合わせを投げない（覚え書きも汚さない）。
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;

  try {
    const res = await fetch("/api/tripCover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: name, destination }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      configured?: boolean;
      cover?: { photo?: string; attribution?: string } | null;
      error?: string;
    };
    // 探しに行って失敗した時（Places APIをまだ有効にしていない等）は覚えない。
    // 覚えてしまうと、設定を直したあとも期限切れまで同梱の写真のままになる。
    if (data.error) return null;
    const photo = data.configured && data.cover?.photo ? data.cover.photo : null;
    const entry: TripCoverEntry = { photo, attribution: data.cover?.attribution, at: Date.now() };
    writeEntry(key, entry);
    return toResolved(entry);
  } catch {
    // 通信できなかっただけ。覚えずに、次に開いた時もう一度試す。
    return null;
  }
}
