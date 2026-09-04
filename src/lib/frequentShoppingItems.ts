import type { Note } from "../types";
import { getNoteType } from "./noteTypes";

/** 買い物リストの候補として出す数の上限。行が折り返して商品欄を押しのけない程度。 */
export const FREQUENT_ITEM_LIMIT = 8;

/** 履歴がまだ無い人にも候補を出すための初期候補。日用品と生鮮の定番だけにして、
 * 好みの分かれるものは入れない — 数回使えば下の集計が履歴で置き換えていく。 */
export const DEFAULT_FREQUENT_ITEMS = [
  "牛乳",
  "卵",
  "パン",
  "米",
  "ヨーグルト",
  "野菜",
  "トイレットペーパー",
  "洗剤",
];

/** 同じ品を「牛乳」「 牛乳 」のように書いた回数をまとめるための正規化。
 * 表示にはこの結果ではなく、実際に打った文字をそのまま使う。 */
function normalize(name: string): string {
  return name.trim().toLowerCase();
}

interface Tally {
  /** 表示に使う文字。いちばん最近書いた綴りを採る。 */
  label: string;
  count: number;
  lastUsedAt: number;
}

/**
 * 過去の買い物リストから「よく買う品」を数えて並べる。
 *
 * 並びは 回数の多い順 → 同じ回数なら最近書いた順。過去に一度も書いていない人には
 * DEFAULT_FREQUENT_ITEMS で埋める(履歴のぶんが先、足りない分だけ後ろに足す)。
 *
 * @param notes     端末内の全ノート。買い物リスト以外は無視する。
 * @param exclude   いま編集中のリストに既に入っている品。候補から外す。
 * @param limit     出す数の上限。
 */
export function frequentShoppingItems(
  notes: Note[],
  exclude: string[] = [],
  limit: number = FREQUENT_ITEM_LIMIT,
): string[] {
  const tallies = new Map<string, Tally>();

  for (const note of notes) {
    if (getNoteType(note) !== "shopping") continue;
    for (const item of note.shoppingItems ?? []) {
      const key = normalize(item.name);
      if (!key) continue;
      // 同じリストの中で同じ品が2行あっても1回と数える方が自然だが、そこまで
      // 揃える価値は無い。リストをまたいだ回数の差の方がずっと大きく効く。
      const usedAt = note.updatedAt ?? note.createdAt;
      const found = tallies.get(key);
      if (!found) {
        tallies.set(key, { label: item.name.trim(), count: 1, lastUsedAt: usedAt });
        continue;
      }
      found.count += 1;
      if (usedAt >= found.lastUsedAt) {
        found.lastUsedAt = usedAt;
        found.label = item.name.trim();
      }
    }
  }

  const excluded = new Set(exclude.map(normalize));
  const ranked = [...tallies.values()]
    .sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt || a.label.localeCompare(b.label))
    .map((t) => t.label)
    .filter((label) => !excluded.has(normalize(label)));

  const result = ranked.slice(0, limit);
  const taken = new Set(result.map(normalize));
  for (const fallback of DEFAULT_FREQUENT_ITEMS) {
    if (result.length >= limit) break;
    const key = normalize(fallback);
    if (taken.has(key) || excluded.has(key)) continue;
    taken.add(key);
    result.push(fallback);
  }
  return result;
}
