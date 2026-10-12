/**
 * 「削除しました・元に戻す」で消せるものと、その本当の削除(UI/UX 調査メモ 第4弾 A-2)。
 *
 * 中身は、これまで各画面がゴミ箱を押した時にその場で呼んでいた削除そのまま(一緒に落とす
 * 別テーブルの行も同じ)。1か所に集めたのは、待っている間にアプリが閉じられた削除を、次に
 * 開いた時に「種類と id」だけから消し切るため(src/lib/deferredDelete.ts の控え)。
 * そのため、ここに書く削除は id だけで完結させる(画面の state に頼らない)。
 */
import { db } from "../db/schema";
import { deleteAttachmentsFor } from "./attachments";
import { deleteCurrencyFor } from "./currency";
import { deleteEventMailLinks } from "./eventMailLink";
import { deletePlaceRemindersFor } from "./placeReminders";
import { deleteProjectTagFor } from "./projectTags";
import { replayInterruptedDeletes as replayJournal } from "./deferredDelete";

/** タスクを本当に消す(サブタスクと場所リマインドも一緒に)。 */
export async function deleteTaskCascade(id: string) {
  const children = await db.tasks.where("parentTaskId").equals(id).toArray();
  await db.tasks.bulkDelete(children.map((c) => c.id!));
  await db.tasks.delete(id);
  // 場所リマインドは別のテーブルにあるので、一緒に落とす
  // (src/lib/placeReminders.ts)。残すと、消したタスクのために鳴り続ける。
  await Promise.all([...children.map((c) => deletePlaceRemindersFor("task", c.id!)), deletePlaceRemindersFor("task", id)]);
}

export const UNDOABLE_DELETES = {
  task: { table: "tasks", remove: deleteTaskCascade },
  // 貼った写真と場所リマインドは別のテーブル(src/lib/attachments.ts / src/lib/placeReminders.ts)。
  note: {
    table: "notes",
    remove: (id: string) =>
      Promise.all([db.notes.delete(id), deleteAttachmentsFor("note", id), deletePlaceRemindersFor("note", id)]),
  },
  // 元メールへのリンクは別のテーブル(src/lib/eventMailLink.ts)。
  calendarEvent: {
    table: "calendarEvents",
    remove: (id: string) => Promise.all([db.calendarEvents.delete(id), deleteEventMailLinks(id)]),
  },
  // 案件タグは別のテーブル(src/lib/projectTags.ts)。残すと年間集計に幽霊の行が出る。
  transaction: {
    table: "transactions",
    remove: (id: string) => Promise.all([db.transactions.delete(id), deleteProjectTagFor(id)]),
  },
  pendingCardCharge: { table: "pendingCardCharges", remove: (id: string) => db.pendingCardCharges.delete(id) },
  // 現地通貨の内訳は別のテーブル(src/lib/currency.ts)。
  tripExpense: {
    table: "tripExpenses",
    remove: (id: string) => Promise.all([db.tripExpenses.delete(id), deleteCurrencyFor(id)]),
  },
  tripPackingItem: { table: "tripPackingItems", remove: (id: string) => db.tripPackingItems.delete(id) },
  tripRoutePlace: { table: "tripRoutePlaces", remove: (id: string) => db.tripRoutePlaces.delete(id) },
} satisfies Record<string, { table: string; remove: (id: string) => Promise<unknown> }>;

export type UndoableDeleteKind = keyof typeof UNDOABLE_DELETES;

/** 待っている間にアプリが閉じられた削除を、いま消し切る。同期の準備ができてから呼ぶ(App.tsx)。 */
export function replayInterruptedDeletes(): Promise<void> {
  const handlers: Record<string, (id: string) => unknown> = {};
  for (const [kind, { remove }] of Object.entries(UNDOABLE_DELETES)) handlers[kind] = remove;
  return replayJournal(handlers);
}
