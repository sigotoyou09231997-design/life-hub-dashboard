import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Vercel向けの入り口。このリポジトリはNetlifyとVercelの両方に配信されており、
 * サーバー関数は netlify/functions/ と api/ に別々に置く決まり(extractTripPlan・
 * generateDraft・tokenExchangeも同じ)。
 *
 * 判断のロジックは netlify/functions/extractReceipt.ts と同じものを写してある。
 * netlify側から読み込む形にすると Vercel のバンドルに含まれず
 * FUNCTION_INVOCATION_FAILED で落ちるため(extractTripPlan.tsの2026-08-25の教訓)。
 * 片方だけ直して食い違わないよう、netlify/__tests__/extractReceipt.test.tsで
 * 両者が同じ結果を返すことを突き合わせている。 */

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

const EXPENSE_CATEGORIES = ["食費", "日用品", "交通費", "娯楽", "交際費", "医療", "美容", "教育", "その他"];
const PAYMENT_METHODS = ["現金", "クレジットカード", "電子マネー", "銀行振込", "その他"];

const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

const MAX_BASE64_CHARS = 10_000_000;

export interface ExtractedReceipt {
  storeName?: string;
  date?: string;
  amount?: number;
  category?: string;
  paymentMethod?: string;
  memo?: string;
}

interface ExtractReceiptBody {
  imageBase64?: string;
  mediaType?: string;
  today?: string;
}

function jsonResponse(res: VercelResponse, statusCode: number, body: unknown) {
  res.status(statusCode).json(body);
}

export const SYSTEM_PROMPT = `あなたは、レシート・領収書の画像から支出の記録に必要な情報を読み取る担当です。

渡された画像1枚から、次の形のJSONだけを返してください。説明文もコードフェンスも付けないでください。
{"receipt":{"storeName":"...","date":"YYYY-MM-DD","amount":1234,"category":"食費","paymentMethod":"現金","memo":"..."}}

ルール:
- storeName はレシートに印字された店名。読み取れなければ省く。
- date は必ず YYYY-MM-DD 形式。年が印字されていなければ、基準日に最も近い年とみなす。
  読み取れなければ省く(基準日をそのまま入れたりしない)。
- amount はレシートの合計金額(税込)を円の整数で入れる。小計しか読めない・複数の
  金額があってどれが合計か分からない場合は省く。
- category は次から選ぶ: ${EXPENSE_CATEGORIES.join("、")}。店名・購入内容から
  最も近いものを1つ選ぶ。判断できなければ「その他」にする。
- paymentMethod は次から選ぶ: ${PAYMENT_METHODS.join("、")}。レシートに支払い方法
  (クレジットカードの下4桁、電子マネー名など)が印字されている時だけ入れる。
  書かれていなければ省く(現金だと決めつけない)。
- memo には日付・金額に含まれない短い補足(会計番号・軽減税率の注記など)だけを
  入れる。レシートの内容を丸写ししない。不要なら省く。
- レシート・領収書として読み取れる内容が無ければ {"receipt":null} を返す。`;

/** Anthropicの応答から、レシートのJSONが書かれた text を取り出す。
 *
 * content の先頭が text とは限らない。claude-sonnet-5 は thinking の指定を省くと
 * 考えながら答える(adaptive)ため、先頭に text を持たない thinking の塊が入る。
 * 旅行の読み取り(extractTripPlan.ts)が、ここを先頭決め打ちで読んでいたせいで
 * 読み取れているのに失敗として返していた(2026-08-30)。同じ形をこちらも直した。 */
export function pickResponseText(content: { type: string; text?: string }[] | undefined): string {
  return content?.find((block) => block.type === "text")?.text ?? "";
}

export function parseReceiptResponse(text: string): ExtractedReceipt | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const raw = (parsed as { receipt?: unknown }).receipt;
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;

  const storeName = typeof row.storeName === "string" && row.storeName.trim() ? row.storeName.trim().slice(0, 100) : undefined;
  const dateRaw = typeof row.date === "string" ? row.date.trim() : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : undefined;
  const rawAmount = typeof row.amount === "number" ? row.amount : Number(row.amount);
  const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? Math.round(rawAmount) : undefined;
  const category = EXPENSE_CATEGORIES.includes(row.category as string) ? (row.category as string) : undefined;
  const paymentMethod = PAYMENT_METHODS.includes(row.paymentMethod as string) ? (row.paymentMethod as string) : undefined;
  const memo = typeof row.memo === "string" && row.memo.trim() ? row.memo.trim().slice(0, 200) : undefined;

  if (!storeName && !date && !amount) return null;
  return { storeName, date, amount, category, paymentMethod, memo };
}

export default async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse(res, 500, { error: "サーバーにAIの接続情報(ANTHROPIC_API_KEY)が設定されていません" });
  }

  let payload: ExtractReceiptBody;
  try {
    payload = req.body ?? {};
    if (typeof payload === "string") payload = JSON.parse(payload);
  } catch {
    return jsonResponse(res, 400, { error: "Invalid JSON body" });
  }
  if (!payload.imageBase64) {
    return jsonResponse(res, 400, { error: "画像が必要です" });
  }
  if (payload.imageBase64.length > MAX_BASE64_CHARS) {
    return jsonResponse(res, 400, { error: "画像が大きすぎます。もう少し小さい画像でお試しください" });
  }
  if (!ALLOWED_MEDIA_TYPES.includes(payload.mediaType as AllowedMediaType)) {
    return jsonResponse(res, 400, { error: "対応していない画像形式です(jpeg/png/webp/gifのみ)" });
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
      // 分け合うため、1024だと考えている途中で切れて本文が出ないことがある。
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: payload.mediaType, data: payload.imageBase64 } },
            { type: "text", text: `[基準日] ${payload.today ?? "(不明)"}` },
          ],
        },
      ],
    }),
  });

  if (!anthropicRes.ok) {
    const text = await anthropicRes.text();
    return jsonResponse(res, anthropicRes.status, { error: `Anthropic API error: ${text}` });
  }

  const data = (await anthropicRes.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
  const text = pickResponseText(data.content);
  if (!text) {
    return jsonResponse(res, 502, { error: "AIから読み取り結果を取得できませんでした。もう一度お試しください" });
  }

  return jsonResponse(res, 200, { receipt: parseReceiptResponse(text) });
};
