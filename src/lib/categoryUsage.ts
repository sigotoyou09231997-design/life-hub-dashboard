import { addDays, isValid, parseISO } from "date-fns";
import type { Transaction, TransactionType } from "../types";
import { toDateStr } from "./date";

/** 何日さかのぼって数えるか。季節で使うカテゴリが変わる(冬は医療が増えるなど)ので、
 * 全期間ではなく直近だけを見る。3か月あれば、月1回のものも並びに効く。 */
export const CATEGORY_USAGE_DAYS = 90;

/** 収支の入力フォームで、カテゴリのボタンを「最近よく使う順」に並べる。
 *
 * - 数えるのは同じ種類(支出なら支出)で、`today` から `days` 日前以降の記録だけ。
 * - 同じ回数どうし・一度も使っていないものは、元の並び(categories の順)のまま。
 *   記録がまったく無い人には、今までと同じ並びがそのまま出る。
 * - 一覧に無いカテゴリ(取り込みで入った独自の名前など)は数えるだけで、ボタンには足さない。 */
export function orderCategoriesByUsage(
  categories: readonly string[],
  transactions: readonly Transaction[],
  type: TransactionType,
  today: string,
  days: number = CATEGORY_USAGE_DAYS,
): string[] {
  const base = parseISO(today);
  const from = isValid(base) ? toDateStr(addDays(base, -days)) : "";

  const counts = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type !== type) continue;
    if (from && transaction.date < from) continue;
    counts.set(transaction.category, (counts.get(transaction.category) ?? 0) + 1);
  }

  // Array.prototype.sort は安定なので、回数が同じなら元の順が保たれる。
  return [...categories].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
}
