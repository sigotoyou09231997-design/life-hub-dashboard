import { db } from "../db/schema";
import type { FixedCost, SubscriptionDetail } from "../types";
import { recordAmountChange } from "./fixedCostHistory";
import type { SubscriptionItem } from "./subscriptions";

/**
 * サブスク(固定費＋付け足し)の書き込み。画面からはここだけを呼ぶ。
 *
 * 固定費(fixedCosts、同期している)と付け足し(subscriptionDetails、types/index.ts の
 * SubscriptionDetail)の2つの表に分かれているので、両方をそろえて書く。
 */

export type DetailFields = Omit<SubscriptionDetail, "id" | "fixedCostId" | "createdAt" | "updatedAt">;

async function detailOf(fixedCostId: string): Promise<SubscriptionDetail | undefined> {
  return db.subscriptionDetails.where("fixedCostId").equals(fixedCostId).first();
}

async function writeDetail(fixedCostId: string, fields: DetailFields): Promise<void> {
  const existing = await detailOf(fixedCostId);
  if (existing?.id) {
    await db.subscriptionDetails.update(existing.id, fields);
  } else {
    await db.subscriptionDetails.add({ ...fields, fixedCostId, createdAt: Date.now() });
  }
}

/** 追加・編集の保存。編集で金額が変わったら、前の額を履歴に残す(値上げに気づくため)。 */
export async function saveSubscription(
  cost: FixedCost,
  detail: DetailFields,
  initial?: FixedCost,
): Promise<string> {
  if (initial?.id) {
    await db.fixedCosts.update(initial.id, cost);
    await recordAmountChange(initial.id, initial.amount, cost.amount);
    await writeDetail(initial.id, detail);
    return initial.id;
  }
  const id = crypto.randomUUID();
  await db.fixedCosts.add({ ...cost, id });
  await writeDetail(id, detail);
  return id;
}

/**
 * 解約。固定費は止め(active=false)、付け足しに解約日を書く。止めるのは、サーバーの
 * 支払日通知や古い版のアプリが active しか見ないため(types/index.ts の SubscriptionDetail)。
 * 記録は消さない — 解約済みの一覧から再契約できるように。
 */
export async function cancelSubscription(item: SubscriptionItem, cancelledAt: string): Promise<void> {
  const id = item.cost.id;
  if (!id) return;
  await db.fixedCosts.update(id, { active: false });
  await writeDetail(id, { ...fieldsOf(item), cancelledAt });
}

/** 再契約。解約日は null で消す(undefined だと他の端末に残る)。 */
export async function resumeSubscription(item: SubscriptionItem): Promise<void> {
  const id = item.cost.id;
  if (!id) return;
  await db.fixedCosts.update(id, { active: true });
  await writeDetail(id, { ...fieldsOf(item), cancelledAt: null });
}

/** 同じ内容でもう1件作る(家族の分・2つ目のアカウントなど)。 */
export async function duplicateSubscription(item: SubscriptionItem): Promise<string> {
  const { id: _id, lastNotifiedMonth: _notified, updatedAt: _updatedAt, ...rest } = item.cost;
  return saveSubscription({ ...rest, title: `${item.cost.title}(コピー)` }, fieldsOf(item));
}

/** 完全に削除(誤って登録したもの用)。付け足しと金額の履歴も一緒に消す。 */
export async function deleteSubscription(item: SubscriptionItem): Promise<void> {
  const id = item.cost.id;
  if (!id) return;
  await db.transaction("rw", [db.fixedCosts, db.subscriptionDetails, db.fixedCostAmountChanges], async () => {
    await db.fixedCosts.delete(id);
    await db.subscriptionDetails.where("fixedCostId").equals(id).delete();
    await db.fixedCostAmountChanges.where("fixedCostId").equals(id).delete();
  });
}

function fieldsOf(item: SubscriptionItem): DetailFields {
  const detail = item.detail;
  return {
    cycle: detail?.cycle ?? "monthly",
    billingMonth: detail?.billingMonth ?? null,
    serviceKey: detail?.serviceKey ?? null,
    startDate: detail?.startDate ?? null,
    trialEndDate: detail?.trialEndDate ?? null,
    cancelledAt: detail?.cancelledAt ?? null,
  };
}
