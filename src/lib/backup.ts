import { db } from "../db/schema";

export async function exportBackup(): Promise<void> {
  const [transactions, fixedCosts, calendarEvents, tasks, notes, settings] = await Promise.all([
    db.transactions.toArray(),
    db.fixedCosts.toArray(),
    db.calendarEvents.toArray(),
    db.tasks.toArray(),
    db.notes.toArray(),
    db.settings.toArray(),
  ]);

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      transactions,
      fixedCosts,
      calendarEvents,
      tasks,
      notes,
      settings,
    },
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
  // 日記・目標・習慣を廃止する前に書き出したファイルには diaryEntries / goals / habits /
  // habitLogs が入っているが、受け皿のテーブルごと無くなっているのでここでは読み飛ばす。
  const d = payload.data ?? {};

  await db.transaction(
    "rw",
    [db.transactions, db.fixedCosts, db.calendarEvents, db.tasks, db.notes, db.settings],
    async () => {
      await Promise.all([
        db.transactions.clear(),
        db.fixedCosts.clear(),
        db.calendarEvents.clear(),
        db.tasks.clear(),
        db.notes.clear(),
        db.settings.clear(),
      ]);

      await Promise.all([
        db.transactions.bulkAdd(d.transactions ?? []),
        db.fixedCosts.bulkAdd(d.fixedCosts ?? []),
        db.calendarEvents.bulkAdd(d.calendarEvents ?? []),
        db.tasks.bulkAdd(d.tasks ?? []),
        db.notes.bulkAdd(d.notes ?? []),
        db.settings.bulkAdd(d.settings ?? []),
      ]);
    },
  );
}
