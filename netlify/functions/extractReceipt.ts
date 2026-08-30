import type { Handler } from "@netlify/functions";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

/** src/lib/categories.tsのEXPENSE_CATEGORIES/PAYMENT_METHODSと必ず揃える
 * (netlify/__tests__/extractReceipt.test.tsで突き合わせている)。AIの推測をこの
 * 選択肢だけに絞り込むために使う — 一覧に無い値を保存すると、支出フォームの
 * プルダウンに映らない項目ができてしまう。 */
const EXPENSE_CATEGORIES = ["食費", "日用品", "交通費", "娯楽", "交際費", "医療", "美容", "教育", "その他"];
const PAYMENT_METHODS = ["現金", "クレジットカード", "電子マネー", "銀行振込", "その他"];

/** Anthropic APIが受け付ける画像形式。 */
const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

/** base64文字列としてのおおよその上限(1000万文字 ≒ 元画像で7〜8MB程度)。スマホの
 * カメラ画像はもっと大きいことがあるが、ここでは「レシート1枚を読む」用途を超えた
 * 極端に大きい入力を弾く安全弁として置く(費用と処理時間の両方を抑える)。 */
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
  /** データURLの接頭辞(data:image/jpeg;base64,)を含まない、生のbase64文字列。 */
  imageBase64?: string;
  mediaType?: string;
  /** 「先月」のような相対的な書き方は無いはずだが、年をまたぐレシート(12/31など)の
   * 年の判断に使う基準日(YYYY-MM-DD)。 */
  today?: string;
}

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
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

/** モデルの応答からJSONを取り出し、使える形の項目だけに絞る。すべて任意項目 —
 * 一部しか読み取れなくても、画面側の確認・修正フォームで人が埋められる。 */
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

/** レシート画像から支出を読み取る。AIの読み取り結果は自動確定せず、画面側で必ず
 * 確認・修正の画面を経由してから保存する(LIFE_HUB_CLAUDE_CODE.md §4.7)。 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: "サーバーにAIの接続情報(ANTHROPIC_API_KEY)が設定されていません" });
  }

  let payload: ExtractReceiptBody;
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }
  if (!payload.imageBase64) {
    return jsonResponse(400, { error: "画像が必要です" });
  }
  if (payload.imageBase64.length > MAX_BASE64_CHARS) {
    return jsonResponse(400, { error: "画像が大きすぎます。もう少し小さい画像でお試しください" });
  }
  if (!ALLOWED_MEDIA_TYPES.includes(payload.mediaType as AllowedMediaType)) {
    return jsonResponse(400, { error: "対応していない画像形式です(jpeg/png/webp/gifのみ)" });
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

  if (!res.ok) {
    const text = await res.text();
    return jsonResponse(res.status, { error: `Anthropic API error: ${text}` });
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
  const text = pickResponseText(data.content);
  if (!text) {
    return jsonResponse(502, { error: "AIから読み取り結果を取得できませんでした。もう一度お試しください" });
  }

  return jsonResponse(200, { receipt: parseReceiptResponse(text) });
};
