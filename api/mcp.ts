import { VercelRequest, VercelResponse } from "@vercel/node";
import { MAX_ITEMS, deliverTripPlan } from "./receiveTripPlan.js";

/**
 * LIFE HUB の受信箱へ旅程を送る、ChatGPT プラグイン用の MCP サーバー(ステートレスな Streamable HTTP)。
 *
 * カスタムGPT のアクション(public/chatgpt/openapi.json)は 2026-12-11 に終わる。アクションは
 * プラグインへ引き継がれず、接続アプリ(MCP サーバー)として作り直す必要があるので、同じ役目を
 * MCP のツールとして出す。中身は同じ受け口(api/receiveTripPlan.ts の deliverTripPlan)で、
 * 検証・件数の上限・「金額は受け取らない」・送信コードの照合は、そちらが行う。
 *
 * ステートレスにしているのは、サーバーレス関数が呼び出しごとに別のプロセスになりうるため
 * (セッションIDを持たない。initialize の結果も毎回その場で作る)。応答は JSON で返す
 * (Streamable HTTP は、POST への応答を JSON か SSE のどちらでも返してよい)。
 * サーバーからの通知は無いので、GET は 405 で断る(仕様が認める返し方)。
 *
 * netlify/functions/mcp.ts と中核の部分は完全に同一(二重に書く決まり。
 * netlify/__tests__/mcp.test.ts が同じ入力で同じ結果になることを確かめる)。
 * 同じフォルダの receiveTripPlan は、拡張子 .js を付けて import する。package.json が type: module なので、
 * Node の ESM は拡張子の無い相対 import を読み込めず、Vercel 上で関数ごと落ちる(FUNCTION_INVOCATION_FAILED。
 * 2026-10-07 に ./receiveTripPlan と書いて実際に落ちた)。TypeScript と vitest は .js を .ts として解決する。
 */

export const SERVER_INFO = { name: "life-hub-trip-inbox", title: "LIFE HUB 旅程の受け取り", version: "1.0.0" };

/** 受け付ける MCP の版。クライアントが挙げた版が無ければ、先頭(いちばん新しい)を返す。 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const TOOL_NAME = "send_trip_plan";

const ITEM_TYPES = ["transport", "lodging", "meal", "sightseeing", "other"];

/** ツールの入力。public/chatgpt/openapi.json の定義と同じ項目(テストが突き合わせる)。 */
export const SEND_TRIP_PLAN_TOOL = {
  name: TOOL_NAME,
  title: "旅程を LIFE HUB の受信箱へ送る",
  description:
    "ユーザーが旅程を確かめ、LIFE HUB に送るよう頼んだ時だけ呼ぶ。作った旅程を LIFE HUB の受信箱に届ける(日程にはそのまま入らず、ユーザーが LIFE HUB で確かめてから入れる)。送信コードは、ユーザーが会話で伝えたものを使う。金額は送れない。",
  inputSchema: {
    type: "object",
    required: ["code", "items"],
    properties: {
      code: {
        type: "string",
        description: "ユーザーが伝えた LIFE HUB の送信コード。例: LH-ABCD-EFGH-JKLM-NPQR-STUV。ユーザーから聞いた通りに入れる。",
      },
      tripName: { type: "string", description: "旅行の名前。例: 四国旅行" },
      startDate: { type: "string", description: "旅行の最初の日。YYYY-MM-DD", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      endDate: { type: "string", description: "旅行の最後の日。YYYY-MM-DD", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      items: {
        type: "array",
        description: `日程。1件が1つの予定。1回に${MAX_ITEMS}件まで。`,
        minItems: 1,
        maxItems: MAX_ITEMS,
        items: {
          type: "object",
          required: ["date", "title"],
          properties: {
            date: { type: "string", description: "その予定の日。YYYY-MM-DD(年つき)", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            startTime: { type: "string", description: "開始時刻。HH:mm(24時間)。決まっている時だけ。", pattern: "^\\d{1,2}:\\d{2}$" },
            endTime: { type: "string", description: "終了時刻。移動なら到着時刻。HH:mm。決まっている時だけ。", pattern: "^\\d{1,2}:\\d{2}$" },
            title: { type: "string", description: "予定の題名。短く。例: 羽田→高松 JAL443、ホテル出発、昼食 讃岐うどん" },
            location: { type: "string", description: "場所の名前(駅・空港・施設)。移動なら出発地。" },
            endLocation: { type: "string", description: "移動の到着地(駅・空港)。移動のときだけ。" },
            type: {
              type: "string",
              enum: ITEM_TYPES,
              description: "transport=移動, lodging=宿泊・チェックイン/アウト, meal=食事, sightseeing=観光・見学, other=起床・準備・休憩など",
            },
            memo: { type: "string", description: "当日必要な短いメモ。予約番号・持ち物など。なければ省く。" },
          },
        },
      },
    },
  },
  outputSchema: {
    type: "object",
    required: ["ok", "message"],
    properties: {
      ok: { type: "boolean", description: "受信箱に届いたか" },
      received: { type: "integer", description: "届いた件数" },
      skipped: { type: "integer", description: "日付か題名が読めずに除いた件数" },
      message: { type: "string", description: "ユーザーに伝える案内" },
    },
  },
  // 受信箱に置くだけで、日程は変えない。受信箱が20件を超えると古い順に消える以外に、取り消せない変更は無い。
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

const INSTRUCTIONS =
  "旅程を作り、ユーザーが LIFE HUB への送信を頼んだ時にだけ send_trip_plan を呼ぶ。送信コードはユーザーに聞く(会話の中でむやみに繰り返さない)。";

type JsonRpcId = string | number | null;
type RpcResponse = Record<string, unknown>;

function rpcResult(id: JsonRpcId, result: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * JSON-RPC のメッセージ1件を処理する。返事が要らないもの(通知・相手からの返事)は null。
 * ステートレスなので、メッセージの中身だけで答えが決まる(前の呼び出しを覚えていない)。
 */
export async function handleMcpMessage(message: unknown): Promise<RpcResponse | null> {
  if (!isObject(message) || message.jsonrpc !== "2.0") {
    return rpcError(null, -32600, "Invalid Request");
  }
  const hasId = "id" in message;
  const id = (hasId ? message.id : null) as JsonRpcId;
  const method = message.method;

  // 相手からの返事(result / error だけで method が無い)は受け取るだけ。
  if (typeof method !== "string") {
    return hasId && ("result" in message || "error" in message) ? null : rpcError(id, -32600, "Invalid Request");
  }

  const params = isObject(message.params) ? message.params : {};

  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : SUPPORTED_PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return hasId ? rpcResult(id, {}) : null;
    case "tools/list":
      return rpcResult(id, { tools: [SEND_TRIP_PLAN_TOOL] });
    case "tools/call": {
      if (params.name !== TOOL_NAME) return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
      const reply = await deliverTripPlan(params.arguments);
      const { ok, received, skipped, message: text } = reply.body;
      const structuredContent: Record<string, unknown> = { ok, message: text };
      if (received !== undefined) structuredContent.received = received;
      if (skipped !== undefined) structuredContent.skipped = skipped;
      // 届かなかった時は isError(ツールの失敗)で返す。モデルが理由(text)を読んで、ユーザーに伝えられる。
      return rpcResult(id, { content: [{ type: "text", text }], structuredContent, isError: !ok });
    }
    default:
      // 通知(id が無い)は、知らないものでも黙って受ける。
      return hasId ? rpcError(id, -32601, `Method not found: ${method}`) : null;
  }
}

/** POST の本文(1件、または配列)を処理する。返事が1つも無ければ null(→ 202)。 */
export async function handleMcpBody(body: unknown): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return rpcError(null, -32600, "Invalid Request");
    const replies = (await Promise.all(body.map((message) => handleMcpMessage(message)))).filter(
      (reply): reply is RpcResponse => reply !== null,
    );
    return replies.length > 0 ? replies : null;
  }
  return handleMcpMessage(body);
}

export default async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== "POST") {
    // 通知を流すための GET の待ち受けは持たない(ステートレスのため)。仕様が認める 405。
    res.setHeader("allow", "POST");
    return res.status(405).json(rpcError(null, -32000, "Method not allowed"));
  }

  let body: unknown;
  try {
    body = req.body ?? null;
    if (typeof body === "string") body = JSON.parse(body);
  } catch {
    return res.status(400).json(rpcError(null, -32700, "Parse error"));
  }

  const reply = await handleMcpBody(body);
  if (reply === null) return res.status(202).end();
  return res.status(200).json(reply);
};
