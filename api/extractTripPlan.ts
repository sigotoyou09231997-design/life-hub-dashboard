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
  /** 差出人。会社名がここにしか無いメール(本文が「ご案内」だけ)でタイトルに使う。 */
  from?: string;
  /** 「来月12日」のような書き方を実際の日付に直すための基準日(YYYY-MM-DD)。 */
  today?: string;
  /** メールが届いた日(YYYY-MM-DD)。「明日」「来週の火曜」は読んだ日ではなく届いた日が
   * 基準なので、基準日とは別に渡す。数日前のメールを開いた時に日付がずれるのを防ぐ。 */
  mailDate?: string;
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

export const SYSTEM_PROMPT = `あなたは、渡された資料から予定を取り出す担当です。

資料は次のいずれか、または組み合わせです。
- メール(面接・面談・説明会の案内、打ち合わせや来社の連絡、航空券・新幹線・ホテル・
  レンタカーなどの予約確認や案内)
- 貼り付けられた文章(旅行会社のしおり、案内のメッセージ、下調べのメモなど)
- 写真(チケット、予約票、パンフレット、旅程表、画面の写し、手書きのメモなど)

そこから、カレンダーや日程表に書き留めるべき項目を取り出してください。旅行のものだけ
ではありません — 面接・面談・説明会・選考・来社・打ち合わせ・受診・提出や申し込みの
締切など、その日時に本人が動くことになる予定はすべて取り出します。

必ず次の形のJSONだけを返してください。説明文もコードフェンスも付けないでください。
{"items":[{"date":"YYYY-MM-DD","startTime":"HH:mm","endTime":"HH:mm","title":"...","location":"...","endLocation":"...","type":"transport","memo":"...","amount":12540}]}

ルール:
- date は必ず YYYY-MM-DD 形式。年が書かれていない場合は、基準日以降で最も近い年とみなす。
- 「明日」「本日」「来週の火曜」のような書き方は、[メールの受信日]が渡されていれば
  その日を基準に直す(読んでいる日ではなく、届いた日が基準)。渡されていなければ[基準日]を使う。
- 「1日目」「2日目」「初日」「最終日」のような書き方は、[旅行の期間]が渡されていれば
  その開始日から数えて実際の日付に直す。[旅行の期間]が無く、日付も読み取れない項目は入れない。
- startTime は資料から分かる時だけ入れる。分からなければその項目から省く(推測で埋めない)。
- endTime には終わりの時刻を入れる。移動なら到着時刻、宿泊ならチェックアウト時刻、
  面接や打ち合わせなら終了予定時刻、食事や観光なら終了時刻。書かれていなければ省く
  (所要時間から計算して埋めたりしない)。日をまたぐ場合は endTime を省き、翌日ぶんを
  別の項目に分ける。
- title は日程表で一目で分かる短さにする。例:「羽田→福岡 JAL123」「ホテルOOにチェックイン」
  「株式会社OO 一次面接」。会社名や施設名が分かる時は必ず入れる。
- location は駅・空港・会場・施設の名前が分かる時だけ入れる。移動(type: transport)では出発する
  駅・空港・営業所の名前を入れる。オンラインの面接や打ち合わせでは「オンライン(Zoom)」の
  ように手段を入れ、URLや会議IDは memo に入れる。
- endLocation は移動の到着地(駅・空港)の名前が分かる時だけ入れる。「東京→新函館北斗」なら
  location は「東京駅」、endLocation は「新函館北斗駅」。移動以外では入れない。
- type は次から選ぶ: transport(飛行機・列車・バス・レンタカーなどの移動), lodging(宿泊・
  チェックイン/アウト), meal(食事の予約), sightseeing(観光・入場・見学の予約),
  other(面接・面談・説明会・打ち合わせ・締切など、上に当てはまらないもの)
- memo には予約番号・座席番号・会議のURL・持ち物・担当者の連絡先など、当日必要になる短い
  情報だけを入れる。資料の丸写しはしない。
- amount にはその項目の代金を、円の数字だけで入れる(「12,540円」なら 12540)。新幹線や
  航空券なら運賃、宿泊なら宿泊費。次の場合は入れない: 金額が書かれていない/旅程全体の
  合計しか書かれておらず、その項目ぶんが分からない/取消手数料や割引額など代金そのもの
  ではない金額。往復の合計しか無い場合は、片道に割り付けたりせず省く。
- 往路と復路、チェックインとチェックアウトは、別々の項目に分ける。
- 日程調整のメールで候補の日時が複数示されている場合は、候補それぞれを別の項目にして、
  memo に「候補日時」と入れる(まだ確定していないことが分かるように)。どれか1つに絞ったり、
  勝手に決めたりしない。
- 提出・申し込み・回答の締切が書かれていれば、その日付の項目として入れる
  (title は「OOの提出締切」のようにする)。
- 件名にしか用件が書かれていない場合も、日時は本文から探して入れる。
- 広告・規約・キャンセル規定・配信停止の案内・求人票の勤務時間や募集要項など、
  その日に本人が動くことにならない内容は入れない。
- 写真では、はっきり読み取れる文字だけを使う。かすれ・手ぶれ・見切れで読めない部分は
  推測で埋めず、その項目ごと省く。
- 日付・エリア・予定が表や箇条書きで並んでいる形も読む。1日の欄に複数の予定が「・」や
  読点で並んでいたら、それぞれ別の項目に分ける(「えのすい・江の島灯籠」なら2件)。
- エリアや場所の欄があれば location に入れる。絵文字はタイトルに残さない。
- 時刻が書かれていない項目も、日付が分かるなら startTime を省いたまま入れる。
- 移動手段の印(車・電車のマークなど)だけが書かれている欄からは、移動の項目を作らない。
  出発地と到着地が分かる時(「新横浜→鎌倉」など)だけ移動として起こす。
- 資料に無い日程を補ったり、一般的なおすすめの観光地を足したりしない。
- 予定が1つも見つからなければ {"items":[]} を返す。`;

/** 日付を YYYY-MM-DD に整える。読めない書き方なら undefined。
 *
 * 「2026-9-3」「2026/09/03」のように桁や区切りが違う形で返ってくることがあり、
 * 形が違うというだけでその項目ごと捨てていた(日付は合っているのに1件も出ない、の一因)。 */
export function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return undefined;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 時刻を HH:mm に整える。読めない書き方なら undefined。
 *
 * 「9:00」と1桁で返ってくることがあり、HH:mm しか通していなかった頃は時刻だけが
 * 黙って落ちて、終日の予定として入っていた。 */
export function normalizeTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** 金額を円の数値にする。読めなければ undefined。
 *
 * 数字だけで返すよう指示しても「12,540円」「¥12,540」で返ってくることがある。
 * 0以下や数字にならないものは、読み違えたまま費用に積むと旅行の予算がずれるので落とす。 */
export function normalizeAmount(value: unknown): number | undefined {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[,，\s円¥￥]/g, ""))
        : Number.NaN;
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : undefined;
}

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
    const date = normalizeDate(row.date);
    const title = typeof row.title === "string" ? row.title.trim() : "";
    // 日付とタイトルが無い項目は日程表に置きようがない。
    if (!date || !title) continue;
    const startTime = normalizeTime(row.startTime);
    // 開始より前の終了時刻は読み違え。日をまたぐ移動は別項目に分けるよう指示している。
    const endTimeRaw = normalizeTime(row.endTime);
    const endTime = endTimeRaw && startTime && endTimeRaw < startTime ? undefined : endTimeRaw;
    const type = SCHEDULE_TYPES.includes(row.type as ScheduleType) ? (row.type as ScheduleType) : "other";
    const readPlace = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
    const location = readPlace(row.location);
    // 到着地は移動だけのもの。宿や観光に付いてきた分は落とす(同じ場所が2度出るだけになる)。
    const endLocation = type === "transport" ? readPlace(row.endLocation) : undefined;
    const memo = typeof row.memo === "string" && row.memo.trim() ? row.memo.trim() : undefined;
    const amount = normalizeAmount(row.amount);
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
  // 「明日」「来週の火曜」を、読んだ日ではなくメールが届いた日から数えるための手がかり。
  if (payload.mailDate) {
    lines.push(`[メールの受信日] ${payload.mailDate}`);
  }
  // 旅行の期間が分かっていれば、「2日目」のような書き方を実際の日付に直せる。
  if (payload.tripStart && payload.tripEnd) {
    lines.push(`[旅行の期間] ${payload.tripStart} 〜 ${payload.tripEnd}`);
  }
  // メール由来のときだけ件名・本文を出す。文章や写真から読むときに空の
  // 「[件名] (件名なし)」を見せると、メールを読み違えたと受け取られかねない。
  if (payload.subject != null || payload.body != null) {
    if (payload.from?.trim()) lines.push(`[差出人] ${payload.from.trim()}`);
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

/** Anthropicの応答から、日程のJSONが書かれた text を取り出す。
 *
 * content の先頭が text とは限らない。claude-sonnet-5 は thinking の指定を省くと
 * 考えながら答える(adaptive)ため、先頭に text を持たない thinking の塊が入る。
 * `content[0].text` を見ていたせいで、読み取り自体は出来ているのに
 * 「AIから日程を取得できませんでした」で止まっていた(2026-08-30)。
 * AI下書き(generateDraft.ts)は元から type で選んでいて、こちらだけ残っていた。 */
export function pickResponseText(content: { type: string; text?: string }[] | undefined): string {
  return content?.find((block) => block.type === "text")?.text ?? "";
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
      // thinking(claude-sonnet-5 は指定を省くと考えながら答える)と本文が同じ枠を
      // 分け合うため、2048だと考えている途中で切れて本文が出ないことがある。
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildContent(payload) }],
    }),
  });

  if (!anthropicRes.ok) {
    const text = await anthropicRes.text();
    return jsonResponse(res, anthropicRes.status, { error: `Anthropic API error: ${text}` });
  }

  const data = (await anthropicRes.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
  const text = pickResponseText(data.content);
  if (data.stop_reason === "max_tokens") {
    return jsonResponse(res, 502, { error: "内容が多すぎて読み取りきれませんでした。分けてもう一度お試しください" });
  }
  if (!text) {
    return jsonResponse(res, 502, { error: "AIから日程を取得できませんでした。もう一度お試しください" });
  }

  return jsonResponse(res, 200, { items: parseTripPlanResponse(text) });
};
