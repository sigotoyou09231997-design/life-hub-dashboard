import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * 海外サッカーの日程(ESPN の公開データ)を、ブラウザの代わりに取って返す(src/lib/soccerFixtures.ts)。
 *
 * ブラウザから ESPN を直接読むと、CORS で止められる(2026-10-25、チーム一覧が取れなかった)。
 * ESPN は「許可する」と返す時と返さない時があり、返しても当てにならないので、サーバーから取る。
 * 取るのは下の2種類だけ(リーグ名・チームidの形を確かめてから) — 何でも中継する窓口にしないため。
 *
 * Vercel だけに置く(Netlify のサイトは 2026-10-21 に消した)。
 */

const ESPN = "https://site.api.espn.com/apis";

/** 問い合わせの形から ESPN のアドレスを作る。形が合わなければ undefined。 */
export function espnUrlFor(kind: unknown, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (kind === "teams" && /^[a-z]{3}\.\d$/.test(value)) return `${ESPN}/v2/sports/soccer/${value}/standings`;
  if (kind === "fixtures" && /^\d{1,8}$/.test(value)) return `${ESPN}/site/v2/sports/soccer/all/teams/${value}/schedule?fixture=true`;
  return undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const url = espnUrlFor(req.query.kind, req.query.value);
  if (!url) return res.status(400).json({ error: "bad request" });
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) return res.status(502).json({ error: `ESPN ${upstream.status}` });
    // 日程は頻繁には変わらない。同じ問い合わせを、15分は使い回す(ESPN への問い合わせを減らす)。
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
    return res.status(200).json(await upstream.json());
  } catch {
    return res.status(502).json({ error: "ESPN unreachable" });
  }
}
