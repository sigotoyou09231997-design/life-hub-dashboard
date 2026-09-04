import { useEffect, useRef } from "react";
import { db } from "../db/schema";
import { checkPlaceReminders, describePlaceReminder } from "../lib/placeReminders";
import type { PlaceReminder } from "../types";

/** 開いている間、この間隔で現在地を見る。 */
const POLL_INTERVAL_MS = 3 * 60 * 1000;

/**
 * 場所リマインドの見張り(src/lib/placeReminders.ts)。
 *
 * **アプリを開いている間だけ動く。** ブラウザ・PWAには地点監視(Geofencing)の仕組みが
 * 無く、Service Worker からは位置情報が取れないので、「閉じている間に駅に着いたら鳴る」
 * はどの端末でも作れない。ここが見るのは、アプリを開いた時・画面に戻ってきた時・
 * 開いている間の3分おきの現在地だけ。2026-09-04に本人がこの範囲で了解済み。
 *
 * リマインドが1件も無いうちは位置情報をまったく触らない — 使っていない人に
 * 許可を求めるダイアログを出さないため。
 */
export function usePlaceReminderWatch(): void {
  // 判定が重ならないようにする門。位置の取得は数秒かかることがあり、その間に
  // 次の周期が来ると、同じ「入った」を2回鳴らしてしまう。
  const runningRef = useRef(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let alive = true;

    async function runOnce(): Promise<void> {
      if (!alive || runningRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

      let reminders: PlaceReminder[];
      try {
        reminders = await db.placeReminders.toArray();
      } catch {
        return;
      }
      // 1件も無ければ、位置情報の許可を求めずに終わる。
      if (reminders.length === 0 || !alive) return;

      runningRef.current = true;
      try {
        const position = await new Promise<GeolocationPosition | null>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve(pos),
            () => resolve(null),
            { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
          );
        });
        if (!position || !alive) return;

        const now = Date.now();
        const checks = checkPlaceReminders(
          reminders,
          { latitude: position.coords.latitude, longitude: position.coords.longitude },
          now,
        );

        for (const check of checks) {
          const { reminder, inside, fired } = check;
          if (!reminder.id) continue;
          // 内外は毎回書き戻す — 次の「またいだかどうか」の判定はこれが元になる。
          if (reminder.inside !== inside || fired) {
            await db.placeReminders.update(reminder.id, {
              inside,
              ...(fired ? { lastNotifiedAt: now } : {}),
            });
          }
          if (fired) await notify(reminder);
        }
      } finally {
        runningRef.current = false;
      }
    }

    void runOnce();
    const timer = window.setInterval(() => void runOnce(), POLL_INTERVAL_MS);
    // 画面に戻ってきた時は周期を待たずに見る — 移動中は閉じているのが普通なので、
    // 開いた瞬間に判定できないと、この機能はほとんど働かない。
    const onVisible = () => {
      if (document.visibilityState === "visible") void runOnce();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

/**
 * 端末の通知を出す。出せない環境(通知が許可されていない・Service Worker が無い)では
 * 何もしない — 鳴らないだけで、判定と記録は進んでいる。
 */
async function notify(reminder: PlaceReminder): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (!("serviceWorker" in navigator)) return;
  // ready ではなく getRegistration を使う(src/lib/snoozedNotifications.ts と同じ理由) —
  // Service Worker を登録していない環境では ready が永久に解決しないため。
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;

  const owner = await ownerTitle(reminder);
  await registration.showNotification(describePlaceReminder(reminder), {
    body: owner ?? "リマインドがあります",
    icon: "/apple-touch-icon.png",
    badge: "/apple-touch-icon.png",
    tag: `place-reminder-${reminder.id}`,
    data: { url: reminder.ownerType === "task" ? "/schedule" : "/records/notes" },
  });
}

/** 通知の本文に出す、付けた相手(タスク・メモ)の名前。消えていれば undefined。 */
async function ownerTitle(reminder: PlaceReminder): Promise<string | undefined> {
  try {
    if (reminder.ownerType === "task") return (await db.tasks.get(reminder.ownerId))?.title;
    return (await db.notes.get(reminder.ownerId))?.title;
  } catch {
    return undefined;
  }
}
