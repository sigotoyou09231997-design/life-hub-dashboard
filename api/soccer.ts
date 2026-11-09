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

interface RawFixture {
  id?: string;
  date?: string;
  season?: { displayName?: string };
  seasonType?: { name?: string };
  competitions?: {
    timeValid?: boolean;
    venue?: { fullName?: string; address?: { city?: string } };
    competitors?: { homeAway?: string; id?: string; team?: { id?: string; displayName?: string } }[];
  }[];
}

/** 日程の応答から、アプリが使う項目だけを残す(1チームぶんで約300KBあったのが、数十分の一になる。スマホで読み込む量と解析の手間を減らす)。 */
export function trimFixtures(body: unknown): { events: RawFixture[] } {
  const events = (body as { events?: RawFixture[] } | null)?.events ?? [];
  return {
    events: events.map((e) => {
      const c = e.competitions?.[0];
      return {
        id: e.id,
        date: e.date,
        season: { displayName: e.season?.displayName },
        seasonType: { name: e.seasonType?.name },
        competitions: [
          {
            timeValid: c?.timeValid,
            venue: { fullName: c?.venue?.fullName, address: { city: c?.venue?.address?.city } },
            competitors: (c?.competitors ?? []).map((t) => ({
              homeAway: t.homeAway,
              id: t.id,
              team: { id: t.team?.id, displayName: t.team?.displayName },
            })),
          },
        ],
      };
    }),
  };
}

/** 直近(36時間前から)の試合を、これからの試合に足す。同じ試合は、これからの側を残す。 */
export function mergeRecent(upcoming: { events: RawFixture[] }, recent: { events: RawFixture[] }, now: number): { events: RawFixture[] } {
  const seen = new Set(upcoming.events.map((e) => e.id));
  const since = now - 36 * 3600 * 1000;
  const extra = recent.events.filter((e) => e.id && !seen.has(e.id) && Date.parse(e.date ?? "") >= since);
  return { events: [...extra, ...upcoming.events] };
}

/** 順位表の応答から、チームの一覧に使う項目(id と名前)だけを残す。 */
export function trimStandings(body: unknown): { entries: { team: { id: string; displayName: string } }[] } {
  const entries: { team: { id: string; displayName: string } }[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const record = node as { entries?: { team?: { id?: string; displayName?: string } }[] };
    for (const entry of record.entries ?? []) {
      const id = entry.team?.id;
      const displayName = entry.team?.displayName;
      if (id && displayName && !seen.has(id)) {
        seen.add(id);
        entries.push({ team: { id, displayName } });
      }
    }
    Object.values(record).forEach((value) => value && typeof value === "object" && walk(value));
  };
  walk(body);
  return { entries };
}

/* ------------------------------------------------------------------
 * AIの最新情報(2026-11-10。ホームと /ai-news の「AIニュース」カード用)
 *
 * 公式ブログ・ニュースサイトの RSS を、ブラウザの代わりに取って1つの一覧にして返す(src/lib/aiNews.ts)。
 * ブラウザから直接読むと CORS で止まるため。**api/ 直下の関数は Vercel の無料枠の上限(12個)に達している**ので、
 * 新しい関数は足さず、この「外から取って中継する」関数に kind=news として相乗りさせている。
 * 取るのは下の決まったアドレスだけ(何でも中継する窓口にしない)。1つが落ちても、取れた分だけ返す。
 * ------------------------------------------------------------------ */

export interface NewsFeed {
  id: string;
  name: string;
  lang: "ja" | "en";
  /** 公式の発表か(絞り込みの「公式」)。 */
  official: boolean;
  url: string;
}

export const NEWS_FEEDS: readonly NewsFeed[] = [
  { id: "itmedia", name: "ITmedia AI+", lang: "ja", official: false, url: "https://rss.itmedia.co.jp/rss/2.0/aiplus.xml" },
  { id: "zenn", name: "Zenn(AI)", lang: "ja", official: false, url: "https://zenn.dev/topics/ai/feed" },
  { id: "openai", name: "OpenAI", lang: "en", official: true, url: "https://openai.com/news/rss.xml" },
  { id: "google", name: "Google AI", lang: "en", official: true, url: "https://blog.google/technology/ai/rss/" },
  { id: "deepmind", name: "Google DeepMind", lang: "en", official: true, url: "https://deepmind.google/blog/rss.xml" },
  { id: "techcrunch", name: "TechCrunch AI", lang: "en", official: false, url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
];

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  sourceId: string;
  lang: "ja" | "en";
  official: boolean;
  /** ISO 日時。読み取れなかった記事は付けない(並びは最後)。 */
  publishedAt?: string;
  summary?: string;
  image?: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** タグの中身を取り出す(CDATA をほどき、実体参照を戻す)。無ければ undefined。 */
function tagText(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return undefined;
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function httpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = decodeEntities(value.trim());
  return /^https?:\/\//i.test(v) ? v : undefined;
}

function attr(block: string, tag: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]+)"`, "i"));
  return m ? m[1] : undefined;
}

function firstImage(block: string): string | undefined {
  for (const tag of ["media:content", "media:thumbnail"]) {
    const m = block.match(new RegExp(`<${tag}\\b[^>]*>`, "i"))?.[0];
    const url = m?.match(/\burl="([^"]+)"/i)?.[1];
    const isImage = m && (/medium="image"/i.test(m) || /type="image\//i.test(m) || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url ?? "") || tag === "media:thumbnail");
    if (url && isImage) return httpsUrl(url);
  }
  const enc = block.match(/<enclosure\b[^>]*>/i)?.[0];
  if (enc && !/type="(?!image\/)/i.test(enc)) return httpsUrl(enc.match(/\burl="([^"]+)"/i)?.[1]);
  const body = tagText(block, "content:encoded") ?? tagText(block, "description") ?? tagText(block, "content") ?? "";
  return httpsUrl(body.match(/<img\b[^>]*\ssrc="([^"]+)"/i)?.[1]);
}

/** RSS / Atom を、記事の一覧にする。形が違う・壊れている時は空の一覧(例外は出さない)。 */
export function parseFeed(xml: string, feed: NewsFeed, limit = 12): NewsItem[] {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const items: NewsItem[] = [];
  for (const block of blocks) {
    if (items.length >= limit) break;
    const title = stripHtml(tagText(block, "title") ?? "");
    const url = httpsUrl(tagText(block, "link")) ?? httpsUrl(attr(block, "link", "href"));
    if (!title || !url) continue;
    const dateRaw = tagText(block, "pubDate") ?? tagText(block, "dc:date") ?? tagText(block, "published") ?? tagText(block, "updated");
    const time = dateRaw ? Date.parse(dateRaw) : NaN;
    const summaryRaw = stripHtml(tagText(block, "description") ?? tagText(block, "summary") ?? "");
    items.push({
      title,
      url,
      source: feed.name,
      sourceId: feed.id,
      lang: feed.lang,
      official: feed.official,
      ...(Number.isFinite(time) ? { publishedAt: new Date(time).toISOString() } : {}),
      ...(summaryRaw ? { summary: summaryRaw.slice(0, 140) } : {}),
      ...(firstImage(block) ? { image: firstImage(block) } : {}),
    });
  }
  return items;
}

/** 全部の記事を新しい順に並べ、同じ記事(同じURL)は1つにして、上から limit 件。日付の無い記事は最後。
 * 1つの出どころが一覧を占領しないよう、出どころごとに perSource 件まで(投稿の多いサイトに、公式の発表が押し流されないため)。 */
export function mergeNews(lists: NewsItem[][], limit = 40, perSource = 7): NewsItem[] {
  const seen = new Set<string>();
  const all = lists.flat().filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));
  all.sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));
  const count: Record<string, number> = {};
  return all.filter((i) => ((count[i.sourceId] = (count[i.sourceId] ?? 0) + 1) <= perSource)).slice(0, limit);
}

async function handleNews(res: VercelResponse) {
  const lists = await Promise.all(
    NEWS_FEEDS.map((feed) =>
      fetch(feed.url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0 LIFE-HUB" } })
        .then((r) => (r.ok ? r.text() : ""))
        .then((xml) => parseFeed(xml, feed))
        .catch(() => [] as NewsItem[]),
    ),
  );
  const items = mergeNews(lists);
  if (items.length === 0) return res.status(502).json({ error: "news unreachable" });
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
  return res.status(200).json({ items });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (req.query.kind === "news") return handleNews(res);
  const url = espnUrlFor(req.query.kind, req.query.value);
  if (!url) return res.status(400).json({ error: "bad request" });
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) return res.status(502).json({ error: `ESPN ${upstream.status}` });
    if (req.query.kind === "fixtures") {
      // 「これからの試合」の応答には、始まった・終わった試合が出てこない。今日の試合が朝のうちに予定から消えないよう、
      // 直近の試合(終わったもの)も、別の応答から足す。取れなくても、これからの試合だけは返す。
      const recent = await fetch(url.replace("?fixture=true", ""), { signal: AbortSignal.timeout(8000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      const body = trimFixtures(await upstream.json());
      res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
      return res.status(200).json(mergeRecent(body, trimFixtures(recent), Date.now()));
    }
    // 日程は頻繁には変わらない。同じ問い合わせを、15分は使い回す(ESPN への問い合わせを減らす)。
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
    const body = await upstream.json();
    return res.status(200).json(req.query.kind === "fixtures" ? trimFixtures(body) : trimStandings(body));
  } catch {
    return res.status(502).json({ error: "ESPN unreachable" });
  }
}
