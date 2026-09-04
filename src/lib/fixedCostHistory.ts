import { db } from "../db/schema";
import type { FixedCostAmountChange } from "../types";

/**
 * 固定費の金額を変えた記録。値上げに後から気づくためのもの。
 *
 * 記録は「編集フォームで金額を変えて保存したとき」にだけ増やす。金額以外を直した
 * 保存や、新しく足したときには残さない — 「前回いくらだったか」を聞きたいのは
 * 金額が動いた時だけで、変わっていない保存まで並べると値上げの行が埋もれる。
 */

/** 履歴に残す上限(1件の固定費あたり)。古いものから落とす。 */
export const MAX_AMOUNT_CHANGES_PER_COST = 24;

/** 金額が動いたときだけ記録する。動いていなければ何もしない。 */
export async function recordAmountChange(
  fixedCostId: string,
  previousAmount: number,
  amount: number,
  changedAt: number = Date.now(),
): Promise<void> {
  if (previousAmount === amount) return;
  await db.fixedCostAmountChanges.add({
    fixedCostId,
    previousAmount,
    amount,
    changedAt,
    createdAt: changedAt,
  });

  const rows = await db.fixedCostAmountChanges.where("fixedCostId").equals(fixedCostId).toArray();
  if (rows.length <= MAX_AMOUNT_CHANGES_PER_COST) return;
  const extra = sortChanges(rows)
    .slice(MAX_AMOUNT_CHANGES_PER_COST)
    .map((row) => row.id!)
    .filter(Boolean);
  if (extra.length > 0) await db.fixedCostAmountChanges.bulkDelete(extra);
}

/** 新しい順。同じ時刻に2件あるときはあとから入れた方を先に見せる。 */
export function sortChanges(changes: FixedCostAmountChange[]): FixedCostAmountChange[] {
  return [...changes].sort((a, b) => b.changedAt - a.changedAt || b.createdAt - a.createdAt);
}

/** 固定費ごとにまとめる(一覧が1件ずつ引かなくて済むように)。 */
export function groupChangesByFixedCost(changes: FixedCostAmountChange[]): Map<string, FixedCostAmountChange[]> {
  const byCost = new Map<string, FixedCostAmountChange[]>();
  for (const change of sortChanges(changes)) {
    const list = byCost.get(change.fixedCostId) ?? [];
    list.push(change);
    byCost.set(change.fixedCostId, list);
  }
  return byCost;
}

/** 直近の変更。1件も無ければ undefined。 */
export function latestChange(changes: FixedCostAmountChange[]): FixedCostAmountChange | undefined {
  return sortChanges(changes)[0];
}

/** 差額(プラスなら値上がり)。 */
export function changeDiff(change: FixedCostAmountChange): number {
  return change.amount - change.previousAmount;
}

/** 「+200円」「−500円」。値上がりかどうかが一目で分かるように符号を付ける。 */
export function changeDiffLabel(change: FixedCostAmountChange): string {
  const diff = changeDiff(change);
  const sign = diff > 0 ? "+" : "−";
  return `${sign}¥${Math.abs(diff).toLocaleString()}`;
}
