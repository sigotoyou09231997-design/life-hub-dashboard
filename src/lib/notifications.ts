import { db } from "../db/schema";
import { todayStr } from "./date";

export function isNotificationSupported(): boolean {
  return "Notification" in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return "denied";
  if (Notification.permission === "default") {
    return Notification.requestPermission();
  }
  return Notification.permission;
}

function fireNotification(title: string, body: string) {
  if (!isNotificationSupported() || Notification.permission !== "granted") return;
  new Notification(title, { body, icon: "/icon-192.svg" });
}

let dailyDigestDoneFor: string | null = null;
let eveningReminderDoneFor: string | null = null;

async function checkAndNotify() {
  const settings = await db.settings.toCollection().first();
  if (!settings?.notificationsEnabled) return;
  if (!isNotificationSupported() || Notification.permission !== "granted") return;

  const now = new Date();
  const today = todayStr();

  const [todayTasks, todayEvents] = await Promise.all([
    db.tasks.where("dueDate").equals(today).toArray(),
    db.calendarEvents.where("date").equals(today).toArray(),
  ]);

  for (const task of todayTasks) {
    if (task.completed || !task.dueTime || !task.notifyMinutesBefore || task.notifiedAt) continue;
    const due = new Date(`${task.dueDate}T${task.dueTime}`);
    const diffMinutes = (due.getTime() - now.getTime()) / 60000;
    if (diffMinutes <= task.notifyMinutesBefore && diffMinutes > task.notifyMinutesBefore - 1) {
      fireNotification("タスクの時間です", `「${task.title}」まもなく期限です`);
      await db.tasks.update(task.id!, { notifiedAt: Date.now() });
    }
  }

  for (const event of todayEvents) {
    if (!event.startTime || !event.notifyMinutesBefore || event.notifiedAt) continue;
    const start = new Date(`${event.date}T${event.startTime}`);
    const diffMinutes = (start.getTime() - now.getTime()) / 60000;
    if (diffMinutes <= event.notifyMinutesBefore && diffMinutes > event.notifyMinutesBefore - 1) {
      fireNotification("予定の時間です", `「${event.title}」まであと${event.notifyMinutesBefore}分です`);
      await db.calendarEvents.update(event.id!, { notifiedAt: Date.now() });
    }
  }

  if (dailyDigestDoneFor !== today) {
    dailyDigestDoneFor = today;
    const incompleteCount = todayTasks.filter((t) => !t.completed).length;
    if (incompleteCount > 0 || todayEvents.length > 0) {
      fireNotification("今日のLIFE HUB", `予定 ${todayEvents.length}件・タスク ${incompleteCount}件があります`);
    }
  }

  if (now.getHours() >= 20 && eveningReminderDoneFor !== today) {
    eveningReminderDoneFor = today;
    const [todayTransactions, todayDiary] = await Promise.all([
      db.transactions.where("date").equals(today).toArray(),
      db.diaryEntries.where("date").equals(today).toArray(),
    ]);
    if (todayTransactions.length === 0) {
      fireNotification("記録を忘れていませんか?", "今日の支出をまだ記録していません");
    }
    if (todayDiary.length === 0) {
      fireNotification("今日の日記を書きませんか?", "1日を振り返ってみましょう");
    }
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startNotificationScheduler() {
  if (intervalId) return;
  checkAndNotify();
  intervalId = setInterval(checkAndNotify, 30_000);
}

export function stopNotificationScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
