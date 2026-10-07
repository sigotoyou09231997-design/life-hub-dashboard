import type { Handler } from "@netlify/functions";
import { publicBaseUrl, resourceUrl } from "./mcp.js";

/**
 * OAuth の「保護されたリソースのメタデータ」(RFC 9728)。ChatGPT は、この MCP サーバーに
 * どこでログインすればよいかを、ここを読んで知る。
 *   /.well-known/oauth-protected-resource            (vercel.json / public/_redirects で、この関数へ)
 *   /.well-known/oauth-protected-resource/api/mcp
 *
 * ログイン(認可サーバー)は Supabase Auth の OAuth 2.1 サーバー。ここは、その場所と、
 * 守っているもの(resource = MCP サーバーの URL)を伝えるだけ。resource は、ChatGPT が接続時に
 * 送ってくる値と一字一句同じでなければならない(api/mcp.ts の resourceUrl と同じ作り)。
 *
 * 反対側のフォルダ(api/ ↔ netlify/functions/)の同名ファイルと、中核の部分は完全に同一
 * (scripts/gen-netlify-functions.mjs が api/ から netlify/functions/ を作り直す)。
 */

export function protectedResourceMetadata(env: Record<string, string | undefined> = process.env): Record<string, unknown> | null {
  const supabaseUrl = env.VITE_SUPABASE_URL;
  if (!supabaseUrl) return null;
  return {
    resource: resourceUrl(publicBaseUrl(env)),
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    scopes_supported: ["openid", "profile", "email"],
    bearer_methods_supported: ["header"],
    resource_name: "LIFE HUB 旅行プランナー",
  };
}

function jsonResponse(statusCode: number, body: unknown, headers: Record<string, string> = {}) {
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
