import { db } from "../db/schema";
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
