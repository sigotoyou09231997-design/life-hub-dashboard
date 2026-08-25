import type { Handler } from "@netlify/functions";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

/** 旅行の日程として取り出せる種類(src/types/index.ts の TripScheduleType と揃える)。 */
const SCHEDULE_TYPES = ["sightseeing", "meal", "transport", "lodging", "other"] as const;
type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export interface ExtractedTripItem {
  date: string;
  startTime?: string;
  title: string;
  location?: string;
  memo?: string;
  type: ScheduleType;
}

interface ExtractTripPlanBody {
  subject?: string;
  body?: string;
  /** 「来月12日」のような書き方を実際の日付に直すための基準日(YYYY-MM-DD)。 */
  today?: string;
}

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** メール本文をそのまま全部渡すと、長い規約やフッターでトークンを使い切る。
 * 予約情報は先頭側にあることがほとんどなので、頭から一定量だけ渡す。 */
const MAX_BODY_CHARS = 12_000;

/** 1回の取り込みで受け付ける件数の上限。往復の便と宿で数件、多くても十数件のはずで、
 * それを大きく超える応答は読み違えているとみなして切り捨てる。 */
const MAX_ITEMS = 20;

export const SYSTEM_PROMPT = `あなたは、メールから旅行の日程を取り出す担当です。

渡されたメール(航空券・新幹線・ホテル・レンタカーなどの予約確認や案内)から、旅行の日程表に
並べるべき項目を取り出してください。

必ず次の形のJSONだけを返してください。説明文もコードフェンスも付けないでください。
{"items":[{"date":"YYYY-MM-DD","startTime":"HH:mm","title":"...","location":"...","type":"transport","memo":"..."}]}

ルール:
- date は必ず YYYY-MM-DD 形式。年が書かれていない場合は、基準日以降で最も近い年とみなす。
- startTime は本文から分かる時だけ入れる。分からなければその項目から省く(推測で埋めない)。
- title は日程表で一目で分かる短さにする。例:「羽田→福岡 JAL123」「ホテルOOにチェックイン」
- location は駅・空港・施設の名前が分かる時だけ入れる。
- type は次から選ぶ: transport(飛行機・列車・バス・レンタカーなどの移動), lodging(宿泊・
  チェックイン/アウト), meal(食事の予約), sightseeing(観光・入場・見学の予約), other(その他)
- memo には予約番号や座席番号など、当日必要になる短い情報だけを入れる。本文の丸写しはしない。
- 往路と復路、チェックインとチェックアウトは、別々の項目に分ける。
- 広告・規約・キャンセル規定・配信停止の案内など、当日の行動に関係しない内容は入れない。
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
    const startTime = typeof row.startTime === "string" && /^\d{2}:\d{2}$/.test(row.startTime.trim())
      ? row.startTime.trim()
      : undefined;
    const type = SCHEDULE_TYPES.includes(row.type as ScheduleType) ? (row.type as ScheduleType) : "other";
    const location = typeof row.location === "string" && row.location.trim() ? row.location.trim() : undefined;
    const memo = typeof row.memo === "string" && row.memo.trim() ? row.memo.trim() : undefined;
    cleaned.push({ date, title, startTime, location, memo, type });
  }
  // 日程表と同じ並び(日付→時刻)にして返す。画面側で並べ直さずに済む。
  cleaned.sort((a, b) => (a.date === b.date ? (a.startTime ?? "").localeCompare(b.startTime ?? "") : a.date.localeCompare(b.date)));
  return cleaned.slice(0, MAX_ITEMS);
}

export function buildUserMessage(payload: ExtractTripPlanBody): string {
  return [
    `[基準日] ${payload.today ?? "(不明)"}`,
    `[件名] ${payload.subject ?? "(件名なし)"}`,
    "[本文]",
    (payload.body ?? "").slice(0, MAX_BODY_CHARS),
  ].join("\n");
}

/** メールの予約情報から旅行の日程を作る。本文をAnthropicへ渡すのは下書き生成
 * (generateDraft.ts)と同じで、鍵をブラウザに出さないためのサーバー経由。 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: "サーバーにAIの接続情報(ANTHROPIC_API_KEY)が設定されていません" });
  }

  let payload: ExtractTripPlanBody;
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }
  if (!payload.body && !payload.subject) {
    return jsonResponse(400, { error: "メールの件名か本文が必要です" });
  }

  const res = await fetch(ANTHROPIC_ENDPOINT, {
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
      messages: [{ role: "user", content: buildUserMessage(payload) }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return jsonResponse(res.status, { error: `Anthropic API error: ${text}` });
  }

  const data = (await res.json()) as { content?: { text?: string }[]; stop_reason?: string };
  const text = data.content?.[0]?.text ?? "";
  if (!text) {
    return jsonResponse(502, { error: "AIから日程を取得できませんでした。もう一度お試しください" });
  }
  if (data.stop_reason === "max_tokens") {
    // 途中で切れたJSONは parseTripPlanResponse が空で返すため、黙って「0件」に
    // 見えてしまう。理由が分かる形で伝える。
    return jsonResponse(502, { error: "メールが長すぎて読み取りきれませんでした。もう一度お試しください" });
  }

  return jsonResponse(200, { items: parseTripPlanResponse(text) });
};
