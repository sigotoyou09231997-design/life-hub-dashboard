import { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * 旅行の表紙写真を、旅行のタイトル・行き先から「その土地の実際の写真」にする。
 *
 * 2手に分かれている。
 *   POST { title, destination } … タイトルから地名をAIに読み取らせ(例:「神奈川旅行」→
 *     「鎌倉」)、Google Places の Text Search でその場所の写真を1枚選んで、写真の
 *     識別子(places/…/photos/…)と撮影者のクレジットを返す。
 *   GET  ?photo=places/…/photos/…  … その写真の画像そのものを返す(中身の中継)。
 *
 * 画像を直接ブラウザに取りに行かせず、ここで中継しているのは Google Maps のAPIキーを
 * ブラウザに出さないため(routeInfo.ts と同じ理由)。
 *
 * 判断のロジックは netlify/functions/tripCover.ts と同じものを写してある。
 * 片方だけ直して食い違わないよう、netlify/__tests__/tripCover.test.ts で両者が同じ
 * 結果を返すことを突き合わせている。
 */

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
/** 地名を1つ取り出すだけの短い仕事なので、速くて安いモデルを使う。 */
const MODEL = "claude-haiku-4-5-20251001";
const PLACES_SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const PLACES_MEDIA_BASE = "https://places.googleapis.com/v1/";
/** 表紙は横長で大きく出る(PCのヒーローで最大 900px 程度)ので、その倍を上限にする。 */
const PHOTO_MAX_WIDTH_PX = 1600;

export const SYSTEM_PROMPT = `あなたは旅行アプリの裏方です。旅行のタイトルと行き先から、その旅行先の写真を探すための検索語を1つだけ決めます。

守ること:
- 実在する地名・観光地の名前にする（例:「神奈川旅行」→「鎌倉 由比ヶ浜」、「北海道 家族旅行」→「札幌 大通公園」）。
- 都道府県だけのような広すぎる語より、写真になる場所（街・海岸・寺社・山・公園）まで寄せる。
- 人名・企業名・宿の名前しか分からない時は、その場所がある地域名にする。
- 旅行先が読み取れない時は空文字にする。
- 返すのは次のJSONだけ。説明や前置きは書かない。

{"query": "検索語"}`;

export interface TripCoverPhoto {
  /** Places API の写真の識別子。そのまま GET ?photo= に渡すと画像が返る。 */
  photo: string;
  /** 撮影者のクレジット（Google の規約上、写真を出す時は併記する）。 */
  attribution?: string;
}

export interface TripCoverResponse {
  configured: boolean;
  /** AIが読み取った検索語。写真が見つからなかった理由を追える。 */
  query?: string;
  cover?: TripCoverPhoto | null;
  error?: string;
}

/** 中継してよい写真の識別子か。Places API が返す形以外は受け取らない
 * （任意のURLを踏ませて社内向けの場所へ通信させられないようにするため）。 */
export function isPlacePhotoName(value: unknown): value is string {
  return typeof value === "string" && /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(value);
}

/** AIが返したJSONから検索語を取り出す。JSON以外が混ざっていても拾えるようにする。 */
export function parsePlaceQueryResponse(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return "";
  try {
    const parsed = JSON.parse(match[0]) as { query?: unknown };
    return typeof parsed.query === "string" ? parsed.query.trim() : "";
  } catch {
    return "";
  }
}

/** AIが使えない・答えられない時の検索語。行き先をそのまま使う。 */
export function fallbackPlaceQuery(title: string, destination: string): string {
  const seed = (destination || title || "").trim();
  // 「〜旅行」「〜の旅」は場所の名前ではないので落とす。
  return seed.replace(/[のな]?\s*(旅行|の旅|旅)$/u, "").trim();
}

/** Text Search の答えから、表紙に使う写真を1枚選ぶ。 */
export function parsePlacesResponse(data: unknown): TripCoverPhoto | null {
  const places = (data as { places?: unknown[] } | null)?.places;
  if (!Array.isArray(places) || places.length === 0) return null;
  for (const place of places) {
    const photos = (place as { photos?: unknown[] }).photos;
    if (!Array.isArray(photos)) continue;
    for (const photo of photos) {
      const { name, authorAttributions } = photo as {
        name?: unknown;
        authorAttributions?: { displayName?: unknown }[];
      };
      if (!isPlacePhotoName(name)) continue;
      const author = authorAttributions?.[0]?.displayName;
      return { photo: name, attribution: typeof author === "string" ? author : undefined };
    }
  }
  return null;
}

async function askPlaceQuery(apiKey: string, title: string, destination: string): Promise<string> {
  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `旅行のタイトル: ${title || "(なし)"}\n行き先: ${destination || "(なし)"}`,
        },
      ],
    }),
  });
  if (!res.ok) return "";
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? []).find((part) => part.type === "text")?.text ?? "";
  return parsePlaceQueryResponse(text);
}

async function searchPlacePhoto(apiKey: string, query: string): Promise<TripCoverPhoto | null> {
  const res = await fetch(PLACES_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.displayName,places.photos",
    },
    body: JSON.stringify({ textQuery: query, languageCode: "ja", maxResultCount: 3 }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
  return parsePlacesResponse(await res.json());
}

function jsonResponse(res: VercelResponse, statusCode: number, body: unknown) {
  return res.status(statusCode).json(body);
}

export default async (req: VercelRequest, res: VercelResponse) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (req.method === "GET") {
    const photo = req.query.photo;
    const name = Array.isArray(photo) ? photo[0] : photo;
    if (!isPlacePhotoName(name)) return jsonResponse(res, 400, { error: "写真の指定が正しくありません" });
    if (!apiKey) return jsonResponse(res, 404, { error: "写真を取得する設定がありません" });
    const photoRes = await fetch(
      `${PLACES_MEDIA_BASE}${name}/media?maxWidthPx=${PHOTO_MAX_WIDTH_PX}&key=${encodeURIComponent(apiKey)}`,
    );
    if (!photoRes.ok) return jsonResponse(res, photoRes.status, { error: "写真を取得できませんでした" });
    const buffer = Buffer.from(await photoRes.arrayBuffer());
    res.setHeader("content-type", photoRes.headers.get("content-type") ?? "image/jpeg");
    // 同じ旅行の表紙を開くたびに取りに行かないよう、ブラウザに持たせる。
    res.setHeader("cache-control", "public, max-age=604800");
    return res.status(200).send(buffer);
  }

  if (req.method !== "POST") return jsonResponse(res, 405, { error: "Method not allowed" });
  if (!apiKey) {
    // キー未設定は異常ではなく「この機能をまだ有効にしていない」状態。
    return jsonResponse(res, 200, { configured: false } satisfies TripCoverResponse);
  }

  const payload = (typeof req.body === "string" ? safeParse(req.body) : req.body) as
    | { title?: string; destination?: string }
    | null;
  const title = (payload?.title ?? "").trim();
  const destination = (payload?.destination ?? "").trim();
  if (!title && !destination) return jsonResponse(res, 400, { error: "旅行のタイトルか行き先が必要です" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  // AIが使えない時も、行き先をそのまま検索語にして写真は探す。
  const query =
    (anthropicKey ? await askPlaceQuery(anthropicKey, title, destination).catch(() => "") : "") ||
    fallbackPlaceQuery(title, destination);
  if (!query) {
    return jsonResponse(res, 200, { configured: true, query: "", cover: null } satisfies TripCoverResponse);
  }

  try {
    const cover = await searchPlacePhoto(apiKey, query);
    return jsonResponse(res, 200, { configured: true, query, cover } satisfies TripCoverResponse);
  } catch (error) {
    return jsonResponse(res, 200, {
      configured: true,
      query,
      cover: null,
      error: error instanceof Error ? error.message : String(error),
    } satisfies TripCoverResponse);
  }
};

function safeParse(body: string): { title?: string; destination?: string } | null {
  try {
    return JSON.parse(body) as { title?: string; destination?: string };
  } catch {
    return null;
  }
}
