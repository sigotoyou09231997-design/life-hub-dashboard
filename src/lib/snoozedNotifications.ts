/**
 * 通知の「あとで」(スヌーズ)。
 *
 * 通知に付けたボタンを押すと、Service Worker(public/push-sw.js)が「いつ・何を
 * 出し直すか」をここと同じ IndexedDB に書き、時間が来たら出し直す。
 *
 * **なぜサーバーではなく端末に持つのか**: 出し直しをサーバーからにすると、
 * 「いつ出し直すか」を貯めるテーブル(人が本番で流すSQL)が要る。依頼が
 * public/push-sw.js と src/lib/pushNotifications.ts を指していることもあり、
 * 端末の中だけで完結する形にしてある。
 *
 * **取りこぼしについて**: Service Worker はブラウザに止められることがあるので、
 * 待っている途中で消えると、その場では出し直せない。書いてある予約は消えないので、
 * (1) 次に何かプッシュが届いた時、(2) 次にアプリを開いた時 に拾って出し直す。
 * 「必ずぴったりN分後」ではなく「N分後以降、いちばん早く気づけた時」になる。
 *
 * DB名・ストア名・行の形は public/push-sw.js と揃えること(あちらは素のJSなので
 * このファイルを読み込めず、同じものを書き写してある)。
 */

export const SNOOZE_DB_NAME = "lifehub-snooze";
export const SNOOZE_STORE = "snoozes";
export const SNOOZE_DB_VERSION = 1;

/** 通知に出す「あとで」の選択肢。push-sw.js の actions と対になる。 */
export const SNOOZE_CHOICES = [
  { action: "snooze-10", minutes: 10, title: "10分後" },
  { action: "snooze-60", minutes: 60, title: "1時間後" },
] as const;

export interface SnoozedNotification {
  id: string;
  title: string;
  body: string;
  url: string;
  /** これ以降に出し直す(epoch ms)。 */
  dueAt: number;
}

/** action 名から待ち時間(分)を引く。知らない action は null(スヌーズしない)。 */
export function snoozeMinutesForAction(action: string): number | null {
  return SNOOZE_CHOICES.find((choice) => choice.action === action)?.minutes ?? null;
}

/** 出し直す時が来たものと、まだのものに分ける。 */
export function partitionDueSnoozes(
  records: SnoozedNotification[],
  nowMs: number,
): { due: SnoozedNotification[]; pending: SnoozedNotification[] } {
  const due: SnoozedNotification[] = [];
  const pending: SnoozedNotification[] = [];
  for (const record of records) {
    (record.dueAt <= nowMs ? due : pending).push(record);
  }
  return { due: due.sort((a, b) => a.dueAt - b.dueAt), pending };
}

function openSnoozeDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SNOOZE_DB_NAME, SNOOZE_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SNOOZE_STORE)) {
        request.result.createObjectStore(SNOOZE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAll(): Promise<SnoozedNotification[]> {
  const db = await openSnoozeDb();
  try {
    return await new Promise<SnoozedNotification[]>((resolve, reject) => {
      const request = db.transaction(SNOOZE_STORE, "readonly").objectStore(SNOOZE_STORE).getAll();
      request.onsuccess = () => resolve((request.result ?? []) as SnoozedNotification[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function remove(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openSnoozeDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SNOOZE_STORE, "readwrite");
      for (const id of ids) tx.objectStore(SNOOZE_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * 時が来た「あとで」を出し直す。アプリを開いた時に呼ぶ — Service Worker が
 * 止められて待てなかったぶんを、ここで拾う。出し直した件数を返す。
 *
 * 通知そのものを出せない環境(Service Worker が無い・通知が許可されていない)では
 * 何もせず 0 を返す。予約は消さないので、次に出せるようになった時に出る。
 */
export async function flushDueSnoozedNotifications(nowMs: number = Date.now()): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  if (!("serviceWorker" in navigator)) return 0;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return 0;

  // ready ではなく getRegistration を使う(clearShownPushNotifications と同じ理由) —
  // Service Worker を登録していない環境では ready が永久に解決しないため。
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return 0;

  let records: SnoozedNotification[];
  try {
    records = await readAll();
  } catch {
    return 0;
  }
  const { due } = partitionDueSnoozes(records, nowMs);
  if (due.length === 0) return 0;

  for (const record of due) {
    await registration.showNotification(record.title, {
      body: record.body,
      icon: "/apple-touch-icon.png",
      badge: "/apple-touch-icon.png",
      data: { url: record.url },
    });
  }
  await remove(due.map((record) => record.id));
  return due.length;
}
