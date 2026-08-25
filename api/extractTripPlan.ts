import { VercelRequest, VercelResponse } from "@vercel/node";

/** Vercel向けの入り口。このリポジトリはNetlifyとVercelの両方に配信されており、
 * サーバー関数は netlify/functions/ と api/ に別々に置く決まり(generateDraft・
 * tokenExchange も同じ)。中身の判断は netlify 側と同じものを使い、二重に書かない —
 * 片方だけ直して食い違うのを避けるため。
 *
 * 2026-08-25: netlify 側にしか置かなかったせいで、Vercelで開いている端末では
 * /api/extractTripPlan が 405 になっていた。 */
import {
  SYSTEM_PROMPT,
  buildUserMessage,
  parseTripPlanResponse,
} from "../netlify/functions/extractTripPlan";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

interface ExtractTripPlanBody {
  subject?: string;
  body?: string;
  today?: string;
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
  if (!payload.body && !payload.subject) {
    return jsonResponse(res, 400, { error: "メールの件名か本文が必要です" });
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
      messages: [{ role: "user", content: buildUserMessage(payload) }],
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
    return jsonResponse(res, 502, { error: "メールが長すぎて読み取りきれませんでした。もう一度お試しください" });
  }

  return jsonResponse(res, 200, { items: parseTripPlanResponse(text) });
};
