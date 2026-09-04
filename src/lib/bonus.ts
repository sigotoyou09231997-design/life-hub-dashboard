import type { Transaction } from "../types";

/**
 * 賞与(ボーナス)。
 *
 * 毎月の給与(SalaryEntry)とは別の収入として、**収支の記録(Transaction)** に
 * 「収入 / ボーナス」として持たせている。SalaryEntry に欄を足す形にしなかったのは、
 * salaries が Supabase と同期しているテーブルで、欄を足すには人が本番で流すSQLが
 * 要るため。収支の記録は既に収入もカテゴリも持っているので、テーブルを増やさずに
 * 表せる(カテゴリ「ボーナス」は src/lib/categories.ts に元からある)。
 *
 * 残額の計算には、その期に入った賞与を給与に足して入れる
 * (src/hooks/usePayPeriodBudget.ts と netlify/functions/checkBudgetAndNotify.ts)。
 * 賞与以外の収入は今までどおり残額には入れない — 臨時収入まで「使えるお金」に
 * するとその月の予算が読めなくなるため、賞与だけを対象にしている。
 */
export const BONUS_CATEGORY = "ボーナス";

export function isBonus(transaction: Pick<Transaction, "type" | "category">): boolean {
  return transaction.type === "income" && transaction.category === BONUS_CATEGORY;
}

/** その期に入った賞与の合計。 */
export function sumBonusIncome(transactions: Transaction[]): number {
  return transactions.reduce((total, transaction) => (isBonus(transaction) ? total + transaction.amount : total), 0);
}

/** 賞与だけを、新しい日が上に来るように並べて返す。 */
export function selectBonuses(transactions: Transaction[]): Transaction[] {
  return transactions
    .filter(isBonus)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}
