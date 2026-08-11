import type { Handler } from "@netlify/functions";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

interface GenerateDraftBody {
  from: string;
  subject: string;
  body: string;
}

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const SYSTEM_PROMPT = `あなたはユーザーの代わりにメール返信の下書きを作成するアシスタントです。
以下の受信メールに対する返信文の本文のみを、そのメールと同じ言語で作成してください。
- 簡潔かつ丁寧な文面にする
- 件名や署名は含めず、本文のみを出力する
- 受信メールに書かれていない事実を作り上げない
- 返信本文以外の説明や前置きは書かない`;

/** Proxies Anthropic's Messages API so the API key never reaches the browser. */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: "Anthropic API is not configured on the server" });
  }

  let payload: GenerateDraftBody;
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }
  if (!payload.subject || !payload.body) {
    return jsonResponse(400, { error: "subject and body are required" });
  }

  const userMessage = `差出人: ${payload.from}\n件名: ${payload.subject}\n本文:\n${payload.body}`;

  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return jsonResponse(res.status, { error: `Anthropic API error: ${text}` });
  }

  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const draft = data.content.find((block) => block.type === "text")?.text ?? "";

  return jsonResponse(200, { draft });
};
