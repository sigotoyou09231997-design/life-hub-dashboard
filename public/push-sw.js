// vite.config.ts の workbox.importScripts 経由で、既存の(generateSWモードで自動生成される)
// Service Workerに importScripts() で読み込ませる素のJS。プリキャッシュ・更新まわりのロジックには
// 一切触れず、push / notificationclick の2イベントだけを追加する。
// ペイロードの形は netlify/functions/checkGmailAndNotify.ts と checkAppUpdate.ts の
// buildNotificationPayload / buildUpdateNotificationPayload と対になる(どちらも title/body/url)。
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
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
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
