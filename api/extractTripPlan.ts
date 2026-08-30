import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Vercel向けの入り口。このリポジトリはNetlifyとVercelの両方に配信されており、
 * サーバー関数は netlify/functions/ と api/ に別々に置く決まり(generateDraft・
 * tokenExchange も同じ)。
 *
 * 判断のロジックは netlify/functions/extractTripPlan.ts と同じものを写してある。
 * netlify側から読み込む形にしたところ、Vercelのバンドルに含まれず
 * FUNCTION_INVOCATION_FAILED で落ちたため(2026-08-25)。片方だけ直して食い違わない
 * よう、netlify/__tests__/extractTripPlan.test.ts で両者が同じ結果を返すことを
 * 突き合わせている。 */

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

/** 旅行の日程として取り出せる種類(src/types/index.ts の TripScheduleType と揃える)。 */
const SCHEDULE_TYPES = ["sightseeing", "meal", "transport", "lodging", "other"] as const;
type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export interface ExtractedTripItem {
  date: string;
  startTime?: string;
  endTime?: string;
  title: string;
  location?: string;
  /** 移動の到着地(駅・空港)。出発地は location に入る。旅行のルートに2地点として
   * 起こすために使う。移動以外では入らない。 */
  endLocation?: string;
  memo?: string;
  type: ScheduleType;
  /** その項目の代金(円)。資料に書かれていて、その項目のものだと分かる時だけ。 */
  amount?: number;
}

/** 読み取りのもとになるもの。
 *
 * subject/body はGmailの取り込み(src/components/gmail/MailPlanImport.tsx)から、
 * text/images は旅行計画の「写真・文章から読み取る」(src/components/trips/TripPlanScanForm.tsx)
 * から渡ってくる。どれか1つでもあれば読み取りを試みる。 */
export interface ExtractTripPlanBody {
  subject?: string;
  body?: string;
  /** 「来月12日」のような書き方を実際の日付に直すための基準日(YYYY-MM-DD)。 */
  today?: string;
  /** 貼り付けられた文章(旅行会社のしおり、案内のメッセージ、ブログの抜粋など)。 */
  text?: string;
  /** 写真(チケット・パンフレット・画面の写しなど)。base64はデータURLの接頭辞を含めない。 */
  images?: { base64?: string; mediaType?: string }[];
  /** 入れ先の旅行の期間。「1日目」「2日目」のような書き方を実際の日付に直すのに使う。 */
  tripStart?: string;
  tripEnd?: string;
}

/** メール本文をそのまま全部渡すと、長い規約やフッターでトークンを使い切る。
 * 予約情報は先頭側にあることがほとんどなので、頭から一定量だけ渡す。 */
const MAX_BODY_CHARS = 12_000;

/** 貼り付けられた文章の上限。しおり1枚ぶんを丸ごと貼れる程度には取る。 */
const MAX_TEXT_CHARS = 20_000;

/** 1回の取り込みで受け付ける件数の上限。往復の便と宿で数件、多くても十数件のはずで、
 * それを大きく超える応答は読み違えているとみなして切り捨てる。 */
const MAX_ITEMS = 20;

/** 一度に渡せる写真の枚数。しおりの見開きや往復のチケットで数枚を想定している。
 * これ以上は読み取りが長くなるうえ、確認する側も追えなくなる。 */
const MAX_IMAGES = 4;

/** 写真1枚あたりのbase64の長さ。Anthropicの画像1枚の上限に収める。画面側で
 * 長辺1600pxに縮めてから送る(src/lib/imageDownscale.ts)ので、通常はここに当たらない。 */
const MAX_IMAGE_BASE64_CHARS = 5_000_000;

/** Anthropicが受け取れる画像の形式(extractReceipt.ts と同じ)。 */
const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export const SYSTEM_PROMPT = `あなたは、渡された資料から旅行の日程を取り出す担当です。

資料は次のいずれか、または組み合わせです。
- メール(航空券・新幹線・ホテル・レンタカーなどの予約確認や案内)
- 貼り付けられた文章(旅行会社のしおり、案内のメッセージ、下調べのメモなど)
- 写真(チケット、予約票、パンフレット、旅程表、画面の写し、手書きのメモなど)

そこから、旅行の日程表に並べるべき項目を取り出してください。

必ず次の形のJSONだけを返してください。説明文もコードフェンスも付けないでください。
{"items":[{"date":"YYYY-MM-DD","startTime":"HH:mm","endTime":"HH:mm","title":"...","location":"...","endLocation":"...","type":"transport","memo":"...","amount":12540}]}

ルール:
- date は必ず YYYY-MM-DD 形式。年が書かれていない場合は、基準日以降で最も近い年とみなす。
- 「1日目」「2日目」「初日」「最終日」のような書き方は、[旅行の期間]が渡されていれば
  その開始日から数えて実際の日付に直す。[旅行の期間]が無く、日付も読み取れない項目は入れない。
- startTime は資料から分かる時だけ入れる。分からなければその項目から省く(推測で埋めない)。
- endTime には終わりの時刻を入れる。移動なら到着時刻、宿泊ならチェックアウト時刻、
  食事や観光なら終了時刻。書かれていなければ省く(所要時間から計算して埋めたりしない)。
  日をまたぐ場合は endTime を省き、翌日ぶんを別の項目に分ける。
- title は日程表で一目で分かる短さにする。例:「羽田→福岡 JAL123」「ホテルOOにチェックイン」
- location は駅・空港・施設の名前が分かる時だけ入れる。移動(type: transport)では出発する
  駅・空港・営業所の名前を入れる。
- endLocation は移動の到着地(駅・空港)の名前が分かる時だけ入れる。「東京→新函館北斗」なら
  location は「東京駅」、endLocation は「新函館北斗駅」。移動以外では入れない。
- type は次から選ぶ: transport(飛行機・列車・バス・レンタカーなどの移動), lodging(宿泊・
  チェックイン/アウト), meal(食事の予約), sightseeing(観光・入場・見学の予約), other(その他)
- memo には予約番号や座席番号など、当日必要になる短い情報だけを入れる。資料の丸写しはしない。
- amount にはその項目の代金を、円の数字だけで入れる(「12,540円」なら 12540)。新幹線や
  航空券なら運賃、宿泊なら宿泊費。次の場合は入れない: 金額が書かれていない/旅程全体の
  合計しか書かれておらず、その項目ぶんが分からない/取消手数料や割引額など代金そのもの
  ではない金額。往復の合計しか無い場合は、片道に割り付けたりせず省く。
- 往路と復路、チェックインとチェックアウトは、別々の項目に分ける。
- 広告・規約・キャンセル規定・配信停止の案内など、当日の行動に関係しない内容は入れない。
- 写真では、はっきり読み取れる文字だけを使う。かすれ・手ぶれ・見切れで読めない部分は
  推測で埋めず、その項目ごと省く。
- 資料に無い日程を補ったり、一般的なおすすめの観光地を足したりしない。
- 旅行の日程が1つも見つからなければ {"items":[]} を返す。`;

/** モデルの応答からJSONを取り出して、日程として使える項目だけに絞る。
 *
 * 「JSONだけ返せ」と指示していても、前置きやコードフェンスが付いてくることがある。
 * ここで弾かずに画面へ流すと、日付の無い項目が日程表に入って一覧が壊れるので、
 * 必要な形が揃っているものだけを通す。 */
export function parseTripPlanResponse(text: string): ExtractedTripItem[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  const cleaned: ExtractedTripItem[] = [];
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const date = typeof row.date === "string" ? row.date.trim() : "";
    const title = typeof row.title === "string" ? row.title.trim() : "";
    // 日付とタイトルが無い項目は日程表に置きようがない。
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) continue;
    const readTime = (value: unknown) =>
      typeof value === "string" && /^\d{2}:\d{2}$/.test(value.trim()) ? value.trim() : undefined;
    const startTime = readTime(row.startTime);
    // 開始より前の終了時刻は読み違え。日をまたぐ移動は別項目に分けるよう指示している。
    const endTimeRaw = readTime(row.endTime);
    const endTime = endTimeRaw && startTime && endTimeRaw < startTime ? undefined : endTimeRaw;
    const type = SCHEDULE_TYPES.includes(row.type as ScheduleType) ? (row.type as ScheduleType) : "other";
    const readPlace = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
    const location = readPlace(row.location);
    // 到着地は移動だけのもの。宿や観光に付いてきた分は落とす(同じ場所が2度出るだけになる)。
    const endLocation = type === "transport" ? readPlace(row.endLocation) : undefined;
    const memo = typeof row.memo === "string" && row.memo.trim() ? row.memo.trim() : undefined;
    // 金額は、正の数として読めるものだけを通す。文字混じりや0/マイナスは、
    // 読み違えたまま費用に積むと旅行の予算がずれるので落とす。
    const rawAmount = typeof row.amount === "number" ? row.amount : Number(row.amount);
    const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? Math.round(rawAmount) : undefined;
    cleaned.push({ date, title, startTime, endTime, location, endLocation, memo, type, amount });
  }
  // 日程表と同じ並び(日付→時刻)にして返す。画面側で並べ直さずに済む。
  cleaned.sort((a, b) => (a.date === b.date ? (a.startTime ?? "").localeCompare(b.startTime ?? "") : a.date.localeCompare(b.date)));
  return cleaned.slice(0, MAX_ITEMS);
}

/** 受け取った写真のうち、そのままAnthropicへ渡せるものだけを返す。
 *
 * 弾いたものを黙って捨てないのが要点 — 4枚選んだのに3枚ぶんしか読まれていない、
 * という状態に本人が気付けないため、1枚でも駄目なら理由を返して読み取り自体を止める。 */
export function readImages(payload: ExtractTripPlanBody): {
  images: { base64: string; mediaType: string }[];
  error?: string;
} {
  const raw = payload.images;
  if (!Array.isArray(raw) || raw.length === 0) return { images: [] };
  if (raw.length > MAX_IMAGES) {
    return { images: [], error: `写真は一度に${MAX_IMAGES}枚までです` };
  }
  const images: { base64: string; mediaType: string }[] = [];
  for (const item of raw) {
    const base64 = typeof item?.base64 === "string" ? item.base64.trim() : "";
    const mediaType = typeof item?.mediaType === "string" ? item.mediaType.trim() : "";
    if (!base64) return { images: [], error: "写真を読み込めませんでした。選び直してお試しください" };
    if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
      return { images: [], error: "対応していない画像形式が含まれています。写真(JPEG・PNG・WebP)を選んでください" };
    }
    if (base64.length > MAX_IMAGE_BASE64_CHARS) {
      return { images: [], error: "写真が大きすぎます。もう少し小さい写真でお試しください" };
    }
    images.push({ base64, mediaType });
  }
  return { images };
}

export function buildUserMessage(payload: ExtractTripPlanBody): string {
  const lines = [`[基準日] ${payload.today ?? "(不明)"}`];
  // 旅行の期間が分かっていれば、「2日目」のような書き方を実際の日付に直せる。
  if (payload.tripStart && payload.tripEnd) {
    lines.push(`[旅行の期間] ${payload.tripStart} 〜 ${payload.tripEnd}`);
  }
  // メール由来のときだけ件名・本文を出す。文章や写真から読むときに空の
  // 「[件名] (件名なし)」を見せると、メールを読み違えたと受け取られかねない。
  if (payload.subject != null || payload.body != null) {
    lines.push(`[件名] ${payload.subject ?? "(件名なし)"}`, "[本文]", (payload.body ?? "").slice(0, MAX_BODY_CHARS));
  }
  if (payload.text?.trim()) {
    lines.push("[貼り付けられた文章]", payload.text.slice(0, MAX_TEXT_CHARS));
  }
  const imageCount = readImages(payload).images.length;
  if (imageCount > 0) {
    lines.push(`[写真] ${imageCount}枚。上の画像に写っている内容から読み取ってください。`);
  }
  return lines.join("\n");
}

/** Anthropicへ渡す中身。画像を先、文章を後ろに置く(そう並べた方が写真を読み違えにくい)。 */
export function buildContent(payload: ExtractTripPlanBody): unknown[] {
  const blocks: unknown[] = readImages(payload).images.map((image) => ({
    type: "image",
    source: { type: "base64", media_type: image.mediaType, data: image.base64 },
  }));
  blocks.push({ type: "text", text: buildUserMessage(payload) });
  return blocks;
}

/** 読み取るもとが1つも渡されていないか。 */
export function hasNoSource(payload: ExtractTripPlanBody, imageCount: number): boolean {
  return !payload.body?.trim() && !payload.subject?.trim() && !payload.text?.trim() && imageCount === 0;
}

function jsonResponse(res: VercelResponse, statusCode: number, body: unknown) {
  res.status(statusCode).json(body);
}

export default async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse(res, 500, { error: "サーバーにAIの接続情報(ANTHROPIC_API_KEY)が設定されていません" });
  }

  let payload: ExtractTripPlanBody;
  try {
    payload = req.body ?? {};
    if (typeof payload === "string") payload = JSON.parse(payload);
  } catch {
    return jsonResponse(res, 400, { error: "Invalid JSON body" });
  }

  const { images, error: imageError } = readImages(payload);
  if (imageError) {
    return jsonResponse(res, 400, { error: imageError });
  }
  if (hasNoSource(payload, images.length)) {
    return jsonResponse(res, 400, { error: "読み取るもとになる文章か写真が必要です" });
  }

  const anthropicRes = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildContent(payload) }],
    }),
  });

  if (!anthropicRes.ok) {
    const text = await anthropicRes.text();
    return jsonResponse(res, anthropicRes.status, { error: `Anthropic API error: ${text}` });
  }

  const data = (await anthropicRes.json()) as { content?: { text?: string }[]; stop_reason?: string };
  const text = data.content?.[0]?.text ?? "";
  if (!text) {
    return jsonResponse(res, 502, { error: "AIから日程を取得できませんでした。もう一度お試しください" });
  }
  if (data.stop_reason === "max_tokens") {
    return jsonResponse(res, 502, { error: "内容が多すぎて読み取りきれませんでした。分けてもう一度お試しください" });
  }

  return jsonResponse(res, 200, { items: parseTripPlanResponse(text) });
};
