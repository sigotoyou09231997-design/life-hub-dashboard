// vite.config.ts の workbox.importScripts 経由で、既存の(generateSWモードで自動生成される)
// Service Workerに importScripts() で読み込ませる素のJS。プリキャッシュ・更新まわりのロジックには
// 一切触れず、push / notificationclick の2イベントだけを追加する。
// ペイロードの形は netlify/functions/checkGmailAndNotify.ts と checkAppUpdate.ts の
// buildNotificationPayload / buildUpdateNotificationPayload と対になる(どちらも title/body/url)。

// --- 「あとで」(スヌーズ) --------------------------------------------------
// 押された通知を、一定時間後に出し直す。DB名・ストア名・行の形・action名は
// src/lib/snoozedNotifications.ts と同じものを書き写してある(このファイルは
// 素のJSで、モジュールを読み込めないため)。片方だけ変えないこと。
const SNOOZE_DB_NAME = "lifehub-snooze";
const SNOOZE_STORE = "snoozes";
const SNOOZE_DB_VERSION = 1;
const SNOOZE_CHOICES = [
  { action: "snooze-10", minutes: 10, title: "10分後" },
  { action: "snooze-60", minutes: 60, title: "1時間後" },
];

function openSnoozeDb() {
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

function putSnooze(record) {
  return openSnoozeDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(SNOOZE_STORE, "readwrite");
        tx.objectStore(SNOOZE_STORE).put(record);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

function readSnoozes() {
  return openSnoozeDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction(SNOOZE_STORE, "readonly").objectStore(SNOOZE_STORE).getAll();
        request.onsuccess = () => {
          db.close();
          resolve(request.result || []);
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      }),
  );
}

function deleteSnoozes(ids) {
  if (ids.length === 0) return Promise.resolve();
  return openSnoozeDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(SNOOZE_STORE, "readwrite");
        for (const id of ids) tx.objectStore(SNOOZE_STORE).delete(id);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

/** 時が来た予約を出し直す。ブラウザに止められて待てなかったぶんも、ここで拾う。 */
function flushDueSnoozes() {
  return readSnoozes()
    .then((records) => {
      const now = Date.now();
      const due = records.filter((record) => record.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
      return Promise.all(
        due.map((record) =>
          self.registration.showNotification(record.title, {
            body: record.body || "",
            icon: "/apple-touch-icon.png",
            badge: "/apple-touch-icon.png",
            data: { url: record.url || "/" },
            actions: SNOOZE_CHOICES.map((choice) => ({ action: choice.action, title: choice.title })),
          }),
        ),
      ).then(() => deleteSnoozes(due.map((record) => record.id)));
    })
    .catch(() => undefined);
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "LIFE HUB";
  const options = {
    body: data.body || "",
    icon: "/apple-touch-icon.png",
    badge: "/apple-touch-icon.png",
    data: { url: data.url || "/" },
    // 「あとで」のボタン。対応していない端末(iOSのSafariなど)では無視され、
    // 通知そのものは今までどおり出る。
    actions: SNOOZE_CHOICES.map((choice) => ({ action: choice.action, title: choice.title })),
  };
  // 何か届いたついでに、待ちきれずに残っている「あとで」も出し直す。
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), flushDueSnoozes()]));
});

self.addEventListener("notificationclick", (event) => {
  const choice = SNOOZE_CHOICES.find((item) => item.action === event.action);
  if (choice) {
    const notification = event.notification;
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      title: notification.title,
      body: notification.body || "",
      url: (notification.data && notification.data.url) || "/",
      dueAt: Date.now() + choice.minutes * 60 * 1000,
    };
    notification.close();
    // 先に書いてから待つ。待っている間にブラウザに止められても予約は残るので、
    // 次のプッシュか、次にアプリを開いた時(flushDueSnoozedNotifications)に出る。
    event.waitUntil(
      putSnooze(record)
        .then(() => new Promise((resolve) => setTimeout(resolve, choice.minutes * 60 * 1000)))
        .then(() => flushDueSnoozes())
        .catch(() => undefined),
    );
    return;
  }

  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});
