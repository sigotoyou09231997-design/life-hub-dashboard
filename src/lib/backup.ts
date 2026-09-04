import { db } from "../db/schema";
import type { AttachmentOwnerType } from "../types";
import { legacySavingsGoalFrom } from "./savingsGoal";

// バックアップに含めるテーブル。Gmail連携(gmailAccounts/syncedEmails/draftReplies)と
// blockedSendersは意図的に除外する — refresh tokenやメール本文などの秘密情報・個人データを
// 含み、書き出したファイルが漏れた場合の影響が大きいため(Gmail_AI_AutoReply_Spec.md)。
const BACKUP_TABLES = [
  "transactions",
  "fixedCosts",
  "calendarEvents",
  "tasks",
  "notes",
  "settings",
  "salaries",
  "trips",
  "tripSchedule",
  "tripExpenses",
  "tripPackingItems",
  "tripRoutePlaces",
  "diaryEntries",
  "paypayTransactions",
  "savingsGoals",
  "jobApplications",
  "categoryBudgets",
  // 予定が持つのは人のid(CalendarEvent.personIds)だけなので、この一覧を含めないと
  // 書き戻した先で「誰の予定か」が全部ただの色なしに戻る。
  "eventPeople",
  // 場所リマインドはタスク・メモのidを指す別テーブル(types/index.ts の PlaceReminder)。
  // 指す先の tasks/notes はこの一覧に入っているので、一緒に戻さないと参照だけが切れる。
  "placeReminders",
] as const;

export async function exportBackup(): Promise<void> {
  const data: Record<string, unknown[]> = {};
  await Promise.all(
    BACKUP_TABLES.map(async (table) => {
      data[table] = await db.table(table).toArray();
    }),
  );

  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    data,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `life-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importBackup(file: File): Promise<void> {
  const text = await file.text();
  const payload = JSON.parse(text);
  // version 1のファイルにはこのBACKUP_TABLESの一部(旧6テーブル)しか無い。無い分は
  // 空配列扱いにして、書き出し当時に存在した分だけ復元する。日記・目標・習慣を廃止する
  // 前に書き出したファイルに残るgoals/habits/habitLogsは、受け皿のテーブルごと無くなって
  // いるのでそのまま無視される。
  const d = payload.data ?? {};

  await db.transaction("rw", BACKUP_TABLES.map((table) => db.table(table)), async () => {
    await Promise.all(BACKUP_TABLES.map((table) => db.table(table).clear()));
    await Promise.all(BACKUP_TABLES.map((table) => db.table(table).bulkAdd(d[table] ?? [])));
    await restoreLegacySavingsGoal(d);
  });

  await pruneOrphanAttachments();
}

/**
 * メモ・日記・旅行の書類に貼った写真は端末の中だけのもので、バックアップには
 * 入っていない(types/index.ts の Attachment — JSONにBlobを入れても空になるため)。
 * 復元で貼り先が入れ替わると、辿れない写真だけが残って場所を取り続けるので、
 * ここで落とす。
 *
 * 旅行の書類(tripDocuments)そのものもバックアップに入れていないので、復元しても
 * 消えずに残る。ただし旅行(trips)の側は入れ替わるため、行き先を失った書類が
 * できることがある。それも一緒に落とす — どの画面からも開けない行になるため。
 *
 * 同じ端末で書き出した同じファイルを戻したときは、メモ・日記・旅行のidも同じまま
 * 戻ってくるので、貼ってあったものはそのまま残る。
 */
async function pruneOrphanAttachments(): Promise<void> {
  const [notes, diaries, trips, documents] = await Promise.all([
    db.notes.toArray(),
    db.diaryEntries.toArray(),
    db.trips.toArray(),
    db.tripDocuments.toArray(),
  ]);

  // 先に、行き先を失った書類を消す。そのあとで写真を見ないと、いま消した書類に
  // 貼ってあった写真が「生きている貼り先」として残ってしまう。
  const aliveTrips = new Set(trips.map((trip) => trip.id));
  const strandedDocuments = documents.filter((document) => !aliveTrips.has(document.tripId));
  if (strandedDocuments.length > 0) {
    await db.tripDocuments.bulkDelete(strandedDocuments.map((document) => document.id!).filter(Boolean));
  }
  const strandedIds = new Set(strandedDocuments.map((document) => document.id));

  const attachments = await db.attachments.toArray();
  const alive: Record<AttachmentOwnerType, Set<string | undefined>> = {
    note: new Set(notes.map((note) => note.id)),
    diary: new Set(diaries.map((entry) => entry.id)),
    tripDocument: new Set(documents.filter((d) => !strandedIds.has(d.id)).map((d) => d.id)),
  };
  const orphans = attachments
    .filter((row) => row.id && !alive[row.ownerType].has(row.ownerId))
    .map((row) => row.id!);
  if (orphans.length > 0) await db.attachments.bulkDelete(orphans);
}

/**
 * 貯金目標を複数持てるようにする前に書き出したファイルには savingsGoals が無く、
 * 目標額は settings.savingsGoalMonthly の側に入っている。そのまま復元すると
 * 目標が1件も無い状態になってサマリーから消えてしまうので、DBの移行
 * (db/schema.ts の v15)と同じ引き継ぎをここでもする。
 */
async function restoreLegacySavingsGoal(data: Record<string, unknown[]>): Promise<void> {
  if (Array.isArray(data.savingsGoals) && data.savingsGoals.length > 0) return;
  const legacy = legacySavingsGoalFrom((data.settings ?? []) as { savingsGoalMonthly?: number }[], Date.now());
  if (legacy) await db.savingsGoals.add(legacy);
}
