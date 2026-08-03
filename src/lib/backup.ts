import { db } from "../db/schema";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/data:(.*);base64/)?.[1] ?? "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportBackup(): Promise<void> {
  const [transactions, fixedCosts, calendarEvents, tasks, notes, diaryEntries, goals, habits, habitLogs, settings] =
    await Promise.all([
      db.transactions.toArray(),
      db.fixedCosts.toArray(),
      db.calendarEvents.toArray(),
      db.tasks.toArray(),
      db.notes.toArray(),
      db.diaryEntries.toArray(),
      db.goals.toArray(),
      db.habits.toArray(),
      db.habitLogs.toArray(),
      db.settings.toArray(),
    ]);

  const diaryEntriesSerialized = await Promise.all(
    diaryEntries.map(async (entry) => ({
      ...entry,
      photos: await Promise.all(entry.photos.map(blobToBase64)),
    })),
  );

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      transactions,
      fixedCosts,
      calendarEvents,
      tasks,
      notes,
      diaryEntries: diaryEntriesSerialized,
      goals,
      habits,
      habitLogs,
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
  const d = payload.data ?? {};

  const diaryEntries = (d.diaryEntries ?? []).map((entry: { photos: string[]; [key: string]: unknown }) => ({
    ...entry,
    photos: (entry.photos ?? []).map(base64ToBlob),
  }));

  await db.transaction(
    "rw",
    [
      db.transactions,
      db.fixedCosts,
      db.calendarEvents,
      db.tasks,
      db.notes,
      db.diaryEntries,
      db.goals,
      db.habits,
      db.habitLogs,
      db.settings,
    ],
    async () => {
      await Promise.all([
        db.transactions.clear(),
        db.fixedCosts.clear(),
        db.calendarEvents.clear(),
        db.tasks.clear(),
        db.notes.clear(),
        db.diaryEntries.clear(),
        db.goals.clear(),
        db.habits.clear(),
        db.habitLogs.clear(),
        db.settings.clear(),
      ]);

      await Promise.all([
        db.transactions.bulkAdd(d.transactions ?? []),
        db.fixedCosts.bulkAdd(d.fixedCosts ?? []),
        db.calendarEvents.bulkAdd(d.calendarEvents ?? []),
        db.tasks.bulkAdd(d.tasks ?? []),
        db.notes.bulkAdd(d.notes ?? []),
        db.diaryEntries.bulkAdd(diaryEntries),
        db.goals.bulkAdd(d.goals ?? []),
        db.habits.bulkAdd(d.habits ?? []),
        db.habitLogs.bulkAdd(d.habitLogs ?? []),
        db.settings.bulkAdd(d.settings ?? []),
      ]);
    },
  );
}
