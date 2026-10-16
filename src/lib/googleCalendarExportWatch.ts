import { db } from "../db/schema";
import { isCalendarSyncReady, syncGoogleCalendar } from "./googleCalendar";

/**
 * 予定を足した・変えた・消した数秒後に、Googleカレンダーへの書き出し(src/lib/googleCalendar.ts の第2段)を走らせる。
 *
 * 取り込みは画面を開いた時(10分に1回)で足りるが、書き出しは「入れたらすぐ Google にも出る」方が自然なので、
 * 予定の表(calendarEvents)への書き込みを Dexie のフックで見て、少し待ってからまとめて1回送る。
 * 予定を書く場所は EventForm だけでなく、メールからの予定化・メモからの予定化・旅行など何か所もあるので、
 * 呼び出し側を1つずつ直すのではなく、表の側で拾う(src/lib/sync.ts の registerSyncedTable と同じ考え方)。
 *
 * - どの予定を送るかは planExport が決めるので、ここは「そろそろ見てほしい」と知らせるだけ
 * - ほかの端末からの同期で届いた変更でも走る。その端末も送るが、Google側のidが毎回同じなので2件にはならない
 * - オフラインの時は送らない(次に画面を開いた時の同期が拾う)
 */
export const EXPORT_DEBOUNCE_MS = 4000;

let installed = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let running: Promise<void> | null = null;

/** 書き出しを少し後に予約する。続けて何度も呼ばれたら、最後の呼び出しから EXPORT_DEBOUNCE_MS 後に1回だけ走る。 */
export function scheduleCalendarExport(delayMs = EXPORT_DEBOUNCE_MS): void {
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runPendingExport();
  }, delayMs);
}

/** 予約された書き出しを走らせる。走っている間にまた予約されたら、終わってからもう一度。 */
export function runPendingExport(): Promise<void> {
  if (running) return running;
  running = (async () => {
    while (dirty) {
      dirty = false;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const accounts = await db.gmailAccounts.toArray();
      for (const account of accounts.filter(isCalendarSyncReady)) {
        await syncGoogleCalendar(account, { pull: false });
      }
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** 予定の表への書き込みを見張り始める(アプリの起動時に1回)。 */
export function installCalendarExportWatcher(): void {
  if (installed) return;
  installed = true;
  const table = db.calendarEvents;
  (table.hook as any)("creating", function (this: { onsuccess?: () => void }) {
    this.onsuccess = () => scheduleCalendarExport();
  });
  (table.hook as any)("updating", function (this: { onsuccess?: () => void }) {
    this.onsuccess = () => scheduleCalendarExport();
    return undefined;
  });
  (table.hook as any)("deleting", function (this: { onsuccess?: () => void }) {
    this.onsuccess = () => scheduleCalendarExport();
  });
}

/** テスト用: 予約と走っている印を消す。 */
export function resetCalendarExportWatcherForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  dirty = false;
  running = null;
}
