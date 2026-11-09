/**
 * AIの最新情報(2026-11-10、本人「AIに関する最新情報ページを作成して。TOPにも表示。カードで出したい」)。
 *
 * 公式ブログ・ニュースサイトの RSS を、api/soccer.ts の kind=news が代わりに取って1つの一覧にして返す
 * (ブラウザから直接は CORS で読めない。api/ の関数の数が上限なので、新しい関数は足さず相乗りしている)。
 * 出どころの一覧は api/soccer.ts の NEWS_FEEDS。Anthropic は RSS を出していないので入っていない。
 * 取れなかった時は、前に取れた一覧(端末に30分ぶん覚えている)を出す。
 */

export interface AiNewsItem {
  title: string;
  url: string;
  source: string;
  sourceId: string;
  lang: "ja" | "en";
  official: boolean;
  publishedAt?: string;
  summary?: string;
  image?: string;
}

export type AiNewsFilter = "all" | "ja" | "official";

export const AI_NEWS_FILTERS: readonly { key: AiNewsFilter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "ja", label: "日本語" },
  { key: "official", label: "公式の発表" },
];

const CACHE_KEY = "lifeHubAiNews:v1";
/** この間は、開き直しても取り直さない。 */
export const AI_NEWS_FRESH_MS = 30 * 60 * 1000;

interface Cached {
  at: number;
  items: AiNewsItem[];
}

export function loadCachedNews(): Cached | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    return typeof parsed.at === "number" && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

function saveCachedNews(items: AiNewsItem[]): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), items } satisfies Cached));
  } catch {
    // 覚えられなくても、画面は出せる。
  }
}

/** 最新の一覧を取る。取れなければ例外。取れたら端末に覚える。 */
export async function fetchAiNews(): Promise<AiNewsItem[]> {
  const res = await fetch("/api/soccer?kind=news");
  if (!res.ok) throw new Error(`news ${res.status}`);
  const body = (await res.json()) as { items?: AiNewsItem[] };
  const items = Array.isArray(body.items) ? body.items.filter((i) => i && i.title && i.url) : [];
  if (items.length === 0) throw new Error("news empty");
  saveCachedNews(items);
  return items;
}

export function filterNews(items: readonly AiNewsItem[], filter: AiNewsFilter): AiNewsItem[] {
  if (filter === "ja") return items.filter((i) => i.lang === "ja");
  if (filter === "official") return items.filter((i) => i.official);
  return [...items];
}

/** 「3時間前」「昨日」「11月5日」。日付が読めない記事は空。 */
export function timeAgoJa(iso: string | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨日";
  if (days < 7) return `${days}日前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** ホームの3枚。新しい順の先頭だけだと、投稿の多い1つのサイトで埋まるので、
 * 「いちばん新しい日本語の記事」「いちばん新しい公式の発表」「そのほかでいちばん新しい記事」の順に選び、新しい順に並べ直す。 */
export function pickHomeNews(items: readonly AiNewsItem[], count = 3): AiNewsItem[] {
  const chosen: AiNewsItem[] = [];
  const take = (item: AiNewsItem | undefined) => {
    if (item && !chosen.includes(item)) chosen.push(item);
  };
  take(items.find((i) => i.lang === "ja"));
  take(items.find((i) => i.official));
  for (const item of items) {
    if (chosen.length >= count) break;
    take(item);
  }
  const rank = (i: AiNewsItem) => items.indexOf(i);
  return chosen.slice(0, count).sort((a, b) => rank(a) - rank(b));
}
