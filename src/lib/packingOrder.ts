import type { TripPackingItem } from "../types";

/**
 * 持ち物の並び順(TripPackingItem.sortOrder、supabase/sql/030)。
 *
 * 並べ替えたことのない持ち物は sortOrder を持たないので、並べ替えた持ち物のあと、入れた順に並ぶ。
 * 並べ替えると、その種類(必需品・衣類…)の中を 1 から振り直す。
 */
export function sortPacking(items: TripPackingItem[]): TripPackingItem[] {
  return [...items].sort(
    (a, b) => (a.sortOrder ?? Number.POSITIVE_INFINITY) - (b.sortOrder ?? Number.POSITIVE_INFINITY) || a.createdAt - b.createdAt,
  );
}

/** from 番目を to 番目へ動かした並び(間のものは1つずつずれる)。 */
export function moveTo<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

/** 並べ替えた後の並びに 1 から番号を振り、番号が変わる持ち物だけを返す(書き込む数を減らす)。 */
export function renumberPacking(ordered: TripPackingItem[]): { id: string; sortOrder: number }[] {
  return ordered
    .map((item, index) => ({ item, sortOrder: index + 1 }))
    .filter(({ item, sortOrder }) => item.id && item.sortOrder !== sortOrder)
    .map(({ item, sortOrder }) => ({ id: item.id!, sortOrder }));
}
