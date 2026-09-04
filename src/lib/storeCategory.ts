import type { Transaction } from "../types";

/** 店名を突き合わせるための形。全角/半角と大文字/小文字の違い、空白の有無で
 * 別の店に見えてしまうのを避ける。 */
export function normalizeStore(store: string): string {
  return store.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
}

export interface StoreCategoryGuess {
  category: string;
  /** 根拠になった過去の支出の件数。 */
  matchedCount: number;
  /** 店名がぴったり一致したか(false なら「打った文字を含む店名」からの推測)。 */
  exact: boolean;
  /** 突き合わせに使った過去の店名(そのままの表記)。 */
  matchedStore: string;
}

export interface StoreSample {
  store: string;
  normalized: string;
  category: string;
  createdAt: number;
}

/** 過去の支出から「店名 → 選んだカテゴリ」の材料を作る。
 * 収入・店名なしは学習元にしない。 */
export function collectStoreSamples(transactions: Transaction[]): StoreSample[] {
  const samples: StoreSample[] = [];
  for (const transaction of transactions) {
    if (transaction.type !== "expense") continue;
    const store = transaction.store?.trim();
    if (!store) continue;
    const normalized = normalizeStore(store);
    if (!normalized) continue;
    samples.push({ store, normalized, category: transaction.category, createdAt: transaction.createdAt });
  }
  return samples;
}

/** 打った店名に一番近い過去の店を探して、その店でいちばん多く選んだカテゴリを返す。
 * 手がかりが無ければ null(候補は出さない)。
 *
 * ぴったり一致を先に見て、無ければ「打った文字を含む店名」を見る — 「セブン」まで
 * 打った時点で「セブンイレブン◯◯店」から拾えるようにするため。ただし1文字では
 * 何にでも当たってしまうので、部分一致は2文字からにしている。 */
export function guessCategoryFromStore(samples: StoreSample[], store: string): StoreCategoryGuess | null {
  const query = normalizeStore(store.trim());
  if (!query) return null;

  const exact = samples.filter((s) => s.normalized === query);
  const matched =
    exact.length > 0
      ? exact
      : query.length >= 2
        ? samples.filter((s) => s.normalized.includes(query) || query.includes(s.normalized))
        : [];
  if (matched.length === 0) return null;

  const tally = new Map<string, { count: number; latest: number }>();
  for (const sample of matched) {
    const current = tally.get(sample.category) ?? { count: 0, latest: 0 };
    tally.set(sample.category, {
      count: current.count + 1,
      latest: Math.max(current.latest, sample.createdAt),
    });
  }

  // 同じ回数なら、最後に選んだ方を採る(店のカテゴリを付け替えた時に追従できる)。
  const [category, stat] = [...tally.entries()].sort(
    (a, b) => b[1].count - a[1].count || b[1].latest - a[1].latest,
  )[0];

  const newest = matched
    .filter((s) => s.category === category)
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  return { category, matchedCount: stat.count, exact: exact.length > 0, matchedStore: newest.store };
}
