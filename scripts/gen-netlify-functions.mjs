// api/ のサーバー関数(Vercel)から、netlify/functions/ の同名ファイル(Netlify)を作り直す。
//
//   node scripts/gen-netlify-functions.mjs
//
// 二重に書く決まり(Vercel と Netlify の両方に中身ごと置く。api/ から netlify/functions/ を import すると
// Vercel で落ちる)のうち、「中核の関数を完全に同一に保つ」部分を人の手に任せないための道具。
// api/ のファイルには、Vercel専用の入り口(handler)の直前に `// @vercel-handler` の行を置く。
// その手前(中核)を写し、`@vercel/node` の import だけ Netlify 用に替え、下の Netlify 用の入り口をつなぐ。
// 中核は netlify/__tests__ の同一性テストでも確かめている(ここを通さずに手で直すと、そこで落ちる)。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MARKER = "// @vercel-handler";
const VERCEL_IMPORT = 'import { VercelRequest, VercelResponse } from "@vercel/node";';
const NETLIFY_IMPORT = 'import type { Handler } from "@netlify/functions";';

/** Netlify 用の入り口。ファイルごとに違うのはここだけ。 */
export const NETLIFY_TAILS = {
  receiveTripPlan: `function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, message: "Method not allowed" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return jsonResponse(400, { ok: false, message: "送る内容がJSONとして読めませんでした。" });
  }

  const reply = await deliverTripPlan(payload);
  return jsonResponse(reply.status, reply.body);
};
`,

  mcp: `function jsonResponse(statusCode: number, body: unknown, headers: Record<string, string> = {}) {
  return { statusCode, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    // 通知を流すための GET の待ち受けは持たない(ステートレスのため)。仕様が認める 405。
    return jsonResponse(405, rpcError(null, -32000, "Method not allowed"), { allow: "POST" });
  }

  let body: unknown;
  try {
    const raw = event.isBase64Encoded && event.body ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    body = JSON.parse(raw ?? "null");
  } catch {
    return jsonResponse(400, rpcError(null, -32700, "Parse error"));
  }

  const reply = await handleMcpBody(body, { accessToken: bearerToken(event.headers.authorization), baseUrl: publicBaseUrl() });
  if (reply === null) return { statusCode: 202, body: "" };
  return jsonResponse(200, reply);
};
`,

  oauthProtectedResource: `function jsonResponse(statusCode: number, body: unknown, headers: Record<string, string> = {}) {
  return { statusCode, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD") {
    return jsonResponse(405, { error: "Method not allowed" }, { allow: "GET, HEAD" });
  }
  const metadata = protectedResourceMetadata();
  if (!metadata) return jsonResponse(503, { error: "LIFE HUB 側の接続設定がありません。" });
  return jsonResponse(200, metadata, { "cache-control": "public, max-age=300" });
};
`,
};

export function netlifySource(apiSource, name) {
  const cut = apiSource.indexOf(MARKER);
  if (cut < 0) throw new Error(`${name}: ${MARKER} の行が api/ のファイルに無い`);
  if (!apiSource.includes(VERCEL_IMPORT)) throw new Error(`${name}: @vercel/node の import が見つからない`);
  const tail = NETLIFY_TAILS[name];
  if (!tail) throw new Error(`${name}: Netlify 用の入り口が scripts/gen-netlify-functions.mjs に無い`);
  return apiSource.slice(0, cut).replace(VERCEL_IMPORT, NETLIFY_IMPORT) + tail;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const name of Object.keys(NETLIFY_TAILS)) {
    const api = readFileSync(join(ROOT, "api", `${name}.ts`), "utf8");
    writeFileSync(join(ROOT, "netlify", "functions", `${name}.ts`), netlifySource(api, name));
    console.log(`netlify/functions/${name}.ts を作り直した`);
  }
}
