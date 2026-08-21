import { BACKGROUND_CANDIDATES } from "./backgrounds";

/** 旅行の表紙に使える背景写真。屋内カットは「旅先」に見えないので、リゾート・
 * 風景・街・建築だけを対象にする。 */
const COVER_CATEGORIES = new Set(["resort", "landscape", "city", "architecture"]);

const TRIP_COVERS: string[] = BACKGROUND_CANDIDATES.filter((candidate) =>
  COVER_CATEGORIES.has(candidate.category),
).map((candidate) => candidate.src);

const FALLBACK_COVER = "/backgrounds/evening-glass-pavilion-v5.jpg";

/**
 * 旅行カードの表紙を1枚選ぶ。以前は全カードが同じ写真で、一覧に並べても
 * どれがどの旅行か絵で見分けられなかった。行き先の文字列から決定的に選ぶので、
 * 同じ旅行はいつ開いても同じ絵になり、別の旅行とは高い確率で別の絵になる。
 */
export function tripCoverImage(seed: string): string {
  if (TRIP_COVERS.length === 0) return FALLBACK_COVER;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TRIP_COVERS[hash % TRIP_COVERS.length];
}
