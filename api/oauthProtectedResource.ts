import { VercelRequest, VercelResponse } from "@vercel/node";
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

// @vercel-handler
export default async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const metadata = protectedResourceMetadata();
  if (!metadata) return res.status(503).json({ error: "LIFE HUB 側の接続設定がありません。" });
  res.setHeader("cache-control", "public, max-age=300");
  return res.status(200).json(metadata);
};
