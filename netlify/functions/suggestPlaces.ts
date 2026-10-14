import type { Handler } from "@netlify/functions";

/**
 * 旅行の日程の「場所」に、都道府県・市区町村を補う提案を AI に出させる
 * (2026-10-14、要望の受信箱「ルートのマップの施設に複数候補があるなら選択できるように」「経路がおかしい」)。
 *
 * 「霊山寺」のように名前だけの場所は、Google マップが同じ名前の別の場所(福島・奈良・京都…)に置いてしまい、
 * ルートが大きく遠回りになる。地名検索(座標)で補う案は、無料の地名検索で試したところ、徳島県鳴門市の霊山寺が
 * 全国12件の候補に入っておらず当てにならなかった。AI は旅行の名前・行き先・ほかの場所(「大麻比古神社 徳島県鳴門市」
 * など)から、どの地域の話かを読んで候補を出せる。
 *
 * ここが返すのは**提案だけ**。日程・ルートを書き換えるのは、画面側(場所をまとめて直すシート)で本人が選んで押した時だけ。
 *
 * - 呼べるのはログイン中の人だけ(Supabase のログインを確かめる)。AI は呼ぶたびにお金がかかるため。
 * - 1回に渡せる場所は MAX_PLACES まで。超えた分は捨てて truncated で知らせる。
 * - 使ったトークン数を返す(画面に費用の目安を出すため)。
 *
 * このファイルのうち、Vercel 専用の入り口(下の方にある印の行)より前が中核で、netlify/functions/suggestPlaces.ts は
 * scripts/gen-netlify-functions.mjs が写して作る(手で直さない)。
 */

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

/** 1回に渡せる「補ってほしい場所」の数。旅行1件ぶん(7日で60か所ほど)に収まる。費用の歯止めも兼ねる。 */
export const MAX_PLACES = 80;
/** 手がかりとして渡す「すでに書いてある場所」の数。 */
export const MAX_CONTEXT = 30;
/** 場所・旅行名1つあたりの長さの上限。 */
export const MAX_TEXT_CHARS = 80;
/** 返してよい候補の数(場所1つあたり)。 */
export const MAX_CANDIDATES = 3;

export interface SuggestPlacesBody {
  tripName?: string;
  destination?: string;
  /** 補ってほしい場所(都道府県・市区町村が書かれていないもの)。 */
  places?: unknown;
  /** すでに都道府県・市区町村が書かれている場所。どの地域を回る旅行かの手がかり。 */
  context?: unknown;
}

export interface PlaceCandidate {
  /** 「元の名前 都道府県市区町村」の形。 */
  to: string;
}

export interface PlaceSuggestionItem {
  from: string;
  candidates: PlaceCandidate[];
  /** 旅行の流れから場所が1つに決まる時だけ true。迷う時は false(画面で「要確認」と出す)。 */
  sure: boolean;
}

export interface SuggestPlacesResult {
  suggestions: PlaceSuggestionItem[];
  /** 場所が多すぎて、先頭の MAX_PLACES 件だけ見た。 */
  truncated: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

export const SYSTEM_PROMPT = `あなたは、日本の旅行の予定表に書かれた場所の名前に、都道府県と市区町村を補う担当です。

名前だけの場所(「霊山寺」「児島駅」など)は、地図で同じ名前の別の場所に置かれてしまうことがあります。
渡された旅行の名前・行き先・ほかの場所(すでに住所が書かれている場所)から、どの地域の話かを読み取って、
いちばん可能性が高い実在の場所を答えてください。

必ず次の形のJSONだけを返してください。説明文もコードフェンスも付けないでください。
{"items":[{"from":"霊山寺","candidates":[{"to":"霊山寺 徳島県鳴門市"},{"to":"霊山寺 奈良県奈良市"}],"sure":false}]}

ルール:
- from は、渡された名前をそのまま(1文字も変えずに)入れる。
- to は、from をそのまま先頭に置き、半角スペースを1つあけて、都道府県と市区町村(町・村・区を含む)を続ける。
  例: 「霊山寺 徳島県鳴門市」。番地・電話番号・営業時間は書かない。名前を言い換えたり短くしたりしない。
- candidates は、可能性の高い順に最大3つ。旅行の流れから1つに決められる時は1つだけにする。
  同じ名前の別の場所が、この旅行と関係なさそうな地域にもあって迷う時だけ、2つ目以降を入れる(最初の候補が旅行の流れに合うもの)。
- sure は、旅行の流れから場所が1つに決まる時(または全国に1か所しか無い有名な場所)は true。迷う時は false。
- 次の場合は、candidates を空の配列にする: 実在の場所だと確信が持てない/固有の場所ではない言葉
  (「昼食」「ホテルで休憩」「自宅」「各自移動」など)/すでに都道府県や市区町村が書かれている。
- 推測で作らない。分からない場所は空にして構わない(間違った場所を出すより、出さない方がいい)。`;

/** 改行・タブ・矢印・表の区切りになる文字を取り除き、前後の空白を詰める。画面の表(「元 → 新」)を壊さないため。 */
export function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/→|=>|->/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanList(value: unknown, limit: number): { items: string[]; truncated: boolean } {
  if (!Array.isArray(value)) return { items: [], truncated: false };
  const seen = new Set<string>();
  const items: string[] = [];
  let truncated = false;
  for (const raw of value) {
    const text = cleanText(raw);
    if (!text || text.length > MAX_TEXT_CHARS || seen.has(text)) continue;
    if (items.length >= limit) {
      truncated = true;
      break;
    }
    seen.add(text);
    items.push(text);
  }
  return { items, truncated };
}

/** 渡された内容を整える。補ってほしい場所が1つも無ければ null。 */
export function readBody(body: SuggestPlacesBody): { tripName: string; destination: string; places: string[]; context: string[]; truncated: boolean } | null {
  const places = cleanList(body.places, MAX_PLACES);
  if (places.items.length === 0) return null;
  return {
    tripName: cleanText(body.tripName).slice(0, MAX_TEXT_CHARS),
    destination: cleanText(body.destination).slice(0, MAX_TEXT_CHARS),
    places: places.items,
    context: cleanList(body.context, MAX_CONTEXT).items,
    truncated: places.truncated,
  };
}

export function buildUserMessage(input: { tripName: string; destination: string; places: string[]; context: string[] }): string {
  const lines: string[] = [];
  if (input.tripName) lines.push(`[旅行の名前] ${input.tripName}`);
  if (input.destination) lines.push(`[行き先] ${input.destination}`);
  lines.push("[補ってほしい場所]", ...input.places.map((place, index) => `${index + 1}. ${place}`));
  if (input.context.length > 0) {
    lines.push("[ほかの場所(すでに住所が書いてある場所。どの地域を回る旅行かの手がかり)]", ...input.context.map((place) => `- ${place}`));
  }
  return lines.join("\n");
}

/** Anthropicの応答から text を取り出す(thinking の塊が先頭に入ることがあるので、先頭とは決めつけない)。 */
export function pickResponseText(content: { type: string; text?: string }[] | undefined): string {
  return content?.find((block) => block.type === "text")?.text ?? "";
}

/**
 * AI の返事を検証して、使える提案だけを残す。AI は間違った形・渡していない場所・言い換えた名前を返すことがあるので、
 * 画面に出す前に必ず通す:
 *  - from は、渡した場所のどれかと**完全に同じ**もの(違うものは捨てる)。
 *  - to は、from で始まり、from より長いもの(名前を言い換えた・短くしたものは捨てる)。長さの上限あり。
 *  - 同じ to の重複は1つに。候補は最大 MAX_CANDIDATES。
 *  - 候補が1つも残らない場所は、提案に含めない(画面では「提案なし」)。
 * 渡した順に並べる。
 */
export function parseSuggestions(text: string, asked: string[]): PlaceSuggestionItem[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const items = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const askedSet = new Set(asked);
  const byFrom = new Map<string, PlaceSuggestionItem>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as { from?: unknown; candidates?: unknown; sure?: unknown };
    if (typeof record.from !== "string" || !askedSet.has(record.from) || byFrom.has(record.from)) continue;
    const from = record.from;
    const candidates: PlaceCandidate[] = [];
    if (Array.isArray(record.candidates)) {
      for (const candidate of record.candidates) {
        const to = cleanText((candidate as { to?: unknown } | null)?.to);
        if (!to || to.length > MAX_TEXT_CHARS + 40 || !to.startsWith(from) || to.length <= from.length) continue;
        if (candidates.some((existing) => existing.to === to)) continue;
        candidates.push({ to });
        if (candidates.length >= MAX_CANDIDATES) break;
      }
    }
    if (candidates.length === 0) continue;
    byFrom.set(from, { from, candidates, sure: record.sure === true });
  }
  return asked.flatMap((place) => {
    const item = byFrom.get(place);
    return item ? [item] : [];
  });
}

export interface SuggestReply {
  status: number;
  body: { error?: string } | SuggestPlacesResult;
}

/** ログイン中の人か。Supabase に、渡されたアクセストークンの持ち主を聞く(AI は呼ぶたびにお金がかかるため、誰でも呼べるままにしない)。 */
export async function verifySession(authorization: string | undefined): Promise<SuggestReply | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { status: 503, body: { error: "LIFE HUB 側の接続設定がありません" } };
  }
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { status: 401, body: { error: "ログインしてから使ってください" } };
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, authorization: `Bearer ${token}` } });
    if (!response.ok) return { status: 401, body: { error: "ログインしてから使ってください" } };
  } catch {
    return { status: 502, body: { error: "ログインを確かめられませんでした。しばらくしてからもう一度お試しください" } };
  }
  return null;
}

/** HTTP の受け口(Vercel・Netlify)が、どちらもこれを呼ぶ。 */
export async function suggestPlaces(method: string | undefined, rawBody: unknown, authorization: string | undefined): Promise<SuggestReply> {
  if (method !== "POST") return { status: 405, body: { error: "Method not allowed" } };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { status: 500, body: { error: "サーバーにAIの接続情報(ANTHROPIC_API_KEY)が設定されていません" } };

  let payload: SuggestPlacesBody;
  try {
    const value = typeof rawBody === "string" ? JSON.parse(rawBody) : (rawBody ?? {});
    payload = value && typeof value === "object" ? (value as SuggestPlacesBody) : {};
  } catch {
    return { status: 400, body: { error: "Invalid JSON body" } };
  }

  const input = readBody(payload);
  if (!input) return { status: 400, body: { error: "補ってほしい場所が必要です" } };

  const denied = await verifySession(authorization);
  if (denied) return denied;

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        // thinking と本文が同じ枠を分け合う(extractTripPlan.ts と同じ事情)。80か所ぶんの返事(1か所あたり約40トークン)に
        // 考える分を足しても収まる大きさ。
        max_tokens: 8000,
        // 当てはめる作業なので、考える時間は短くて足りる(長いと Vercel の制限時間を超える。extractTripPlan.ts の 2026-09-27 の件)。
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(input) }],
      }),
    });
  } catch {
    return { status: 502, body: { error: "AIにつながりませんでした。しばらくしてからもう一度お試しください" } };
  }

  if (!anthropicRes.ok) {
    const text = await anthropicRes.text();
    return { status: anthropicRes.status, body: { error: `Anthropic API error: ${text}` } };
  }

  const data = (await anthropicRes.json()) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (data.stop_reason === "max_tokens") {
    return { status: 502, body: { error: "場所が多すぎて答えきれませんでした。分けてもう一度お試しください" } };
  }
  const text = pickResponseText(data.content);
  if (!text) return { status: 502, body: { error: "AIから提案を取得できませんでした。もう一度お試しください" } };

  const usage = { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
  // 費用を後で見直せるよう、使ったトークン数を記録に残す(Vercel のログ)。場所の名前は残さない。
  console.info("[suggestPlaces] usage", { places: input.places.length, ...usage });
  return { status: 200, body: { suggestions: parseSuggestions(text, input.places), truncated: input.truncated, usage } };
}

export const handler: Handler = async (event) => {
  const authorization = event.headers.authorization ?? event.headers.Authorization;
  const reply = await suggestPlaces(event.httpMethod, event.body ?? "{}", authorization);
  return { statusCode: reply.status, headers: { "content-type": "application/json" }, body: JSON.stringify(reply.body) };
};
