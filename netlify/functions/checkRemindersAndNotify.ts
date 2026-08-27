import { schedule, type Handler } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendNotification, setVapidDetails, WebPushError } from "web-push";

/** push_subscriptions.disabled_categoriesに入り得る値。設定画面(SettingsPage)から
 * カテゴリごとにON/OFFできる(supabase/sql/019)。Gmail・アプリ更新は既存の別関数の担当。 */
type ReminderCategory = "events" | "tasks" | "fixed_costs";

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  disabled_categories: string[] | null;
}

interface CalendarEventRow {
  id: string;
  user_id: string;
  title: string;
  date: string;
  start_time: string | null;
  all_day: boolean | null;
  notify_minutes_before: number | null;
  notified_at: number | null;
}

interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  notify_minutes_before: number | null;
  notified_at: number | null;
}

interface FixedCostRow {
  id: string;
  user_id: string;
  title: string;
  amount: number;
  due_day: number;
  active: boolean;
  notify_days_before: number | null;
  last_notified_month: string | null;
}

const ONE_MINUTE_MS = 60_000;
const ONE_DAY_MS = 24 * 60 * 60_000;
// 2分おきの実行が多少遅れても、予定・タスクの時刻通知を取りこぼさないための猶予。
const TIMED_REMINDER_GRACE_MS = 30 * ONE_MINUTE_MS;
// このアプリは個人利用の日本語専用アプリという前提(CLAUDE.md)。予定・タスク・固定費の
// 日時はすべて端末のローカル時刻のままタイムゾーン情報を持たずに保存されているため、
// この関数専用の割り切りとしてJST固定で解釈する。
const JST_OFFSET = "+09:00";
const JST_OFFSET_MS = 9 * 60 * 60_000;

function targetMomentJstMs(date: string, time: string): number {
  return new Date(`${date}T${time}:00${JST_OFFSET}`).getTime();
}

/** 予定・タスクに共通の「時刻通知」判定。繰り返し予定は最初の回にしか通知しない
 * (将来の回はeventSpan.ts側の計算だけで存在し、この行を書き換えずに出るため、
 * 「その回ぶんだけ既読にする」が行の再利用と両立しない — 割り切りとして明記する)。 */
export function isTimedReminderDue(
  row: {
    date: string | null;
    time: string | null;
    allDay: boolean;
    notifyMinutesBefore: number | null;
    notifiedAt: number | null;
  },
  nowMs: number,
): boolean {
  if (row.allDay || row.notifiedAt != null || row.notifyMinutesBefore == null || !row.date || !row.time) return false;
  const target = targetMomentJstMs(row.date, row.time);
  if (Number.isNaN(target)) return false;
  const notifyAt = target - row.notifyMinutesBefore * ONE_MINUTE_MS;
  return nowMs >= notifyAt && nowMs <= target + TIMED_REMINDER_GRACE_MS;
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

/** dueDayを月末でクランプした、その月の支払日(JST午前0時、epoch ms)。 */
function clampedDueDateMs(year: number, monthIndex0: number, dueDay: number): number {
  const day = Math.min(Math.max(dueDay, 1), daysInMonth(year, monthIndex0));
  const mm = String(monthIndex0 + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return new Date(`${year}-${mm}-${dd}T00:00:00${JST_OFFSET}`).getTime();
}

/** nowMsをJSTの壁時計として見たときの年・月(0始まり)。 */
export function jstYearMonth(nowMs: number): { year: number; monthIndex0: number } {
  const shifted = new Date(nowMs + JST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), monthIndex0: shifted.getUTCMonth() };
}

/**
 * 固定費の支払日リマインダー判定。今月・来月の支払日を両方候補にする —
 * 「10/1の3日前」は9月側から見つける必要があるため。通知すべきなら、その支払いの月
 * (繰り上げ元ではなく実際に支払う月、YYYY-MM)を返す。lastNotifiedMonthと一致する
 * (＝その支払いぶんはもう通知済み)ならnullを返す。
 */
export function fixedCostReminderMonth(
  row: { dueDay: number; notifyDaysBefore: number | null; lastNotifiedMonth: string | null; active: boolean },
  nowMs: number,
  todayYear: number,
  todayMonth0: number,
): string | null {
  if (!row.active || row.notifyDaysBefore == null) return null;
  for (const offset of [0, 1]) {
    let year = todayYear;
    let monthIndex0 = todayMonth0 + offset;
    if (monthIndex0 > 11) {
      monthIndex0 -= 12;
      year += 1;
    }
    const dueMs = clampedDueDateMs(year, monthIndex0, row.dueDay);
    const windowStartMs = dueMs - row.notifyDaysBefore * ONE_DAY_MS;
    const windowEndMs = dueMs + ONE_DAY_MS; // 支払日当日いっぱいまで
    if (nowMs < windowStartMs || nowMs >= windowEndMs) continue;
    const forMonth = `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
    return row.lastNotifiedMonth === forMonth ? null : forMonth;
  }
  return null;
}

/** 通知の文面。checkGmailAndNotify.ts/checkAppUpdate.tsと同じくpublic/push-sw.jsの
 * 単一のpushハンドラで消費される形(title/body/url)。 */
export function buildEventReminderPayload(title: string, startTime: string | null): string {
  const body = startTime ? `${startTime}〜の予定です` : "";
  return JSON.stringify({ title: `まもなく: ${title}`, body, url: "/schedule?view=today" });
}

export function buildTaskReminderPayload(title: string): string {
  return JSON.stringify({ title: `タスクの期限が近づいています: ${title}`, body: "", url: "/schedule?view=today" });
}

export function buildFixedCostReminderPayload(title: string, amount: number, dueDay: number): string {
  return JSON.stringify({
    title: `支払い日が近づいています: ${title}`,
    body: `毎月${dueDay}日 ・ ¥${Math.round(amount).toLocaleString()}`,
    url: "/records/expense",
  });
}

async function sendToUser(
  supabase: SupabaseClient,
  userId: string,
  category: ReminderCategory,
  payload: string,
  logPrefix: string,
): Promise<void> {
  const { data: subs, error } = await supabase.from("push_subscriptions").select("*").eq("user_id", userId);
  if (error) {
    console.error(`${logPrefix} failed to load push_subscriptions:`, error.message);
    return;
  }
  for (const sub of (subs ?? []) as PushSubscriptionRow[]) {
    if ((sub.disabled_categories ?? []).includes(category)) continue;
    try {
      await sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload);
    } catch (err) {
      if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
        // 購読切れ(ブラウザ側で解除済み) — このデバイスの購読情報を削除する
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        console.error(`${logPrefix} push send failed:`, err);
      }
    }
  }
}

async function processEvents(supabase: SupabaseClient, nowMs: number): Promise<void> {
  const { data, error } = await supabase
    .from("calendar_events")
    .select("id, user_id, title, date, start_time, all_day, notify_minutes_before, notified_at")
    .not("notify_minutes_before", "is", null)
    .is("notified_at", null);
  if (error) {
    console.error("[checkRemindersAndNotify:events] failed to load calendar_events:", error.message);
    return;
  }
  for (const row of (data ?? []) as CalendarEventRow[]) {
    const due = isTimedReminderDue(
      {
        date: row.date,
        time: row.start_time,
        allDay: Boolean(row.all_day),
        notifyMinutesBefore: row.notify_minutes_before,
        notifiedAt: row.notified_at,
      },
      nowMs,
    );
    if (!due) continue;
    // 送信の成否に関わらず先にチェックポイントを進める(checkGmailAndNotify.ts/
    // checkAppUpdate.tsと同じ理由) — 進められなかった行だけ次回また拾う。
    const { error: updateError } = await supabase.from("calendar_events").update({ notified_at: nowMs }).eq("id", row.id);
    if (updateError) {
      console.error(`[checkRemindersAndNotify:events] failed to mark ${row.id} notified:`, updateError.message);
      continue;
    }
    await sendToUser(supabase, row.user_id, "events", buildEventReminderPayload(row.title, row.start_time), "[checkRemindersAndNotify:events]");
  }
}

async function processTasks(supabase: SupabaseClient, nowMs: number): Promise<void> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, user_id, title, due_date, due_time, notify_minutes_before, notified_at")
    .not("notify_minutes_before", "is", null)
    .is("notified_at", null)
    .eq("completed", false);
  if (error) {
    console.error("[checkRemindersAndNotify:tasks] failed to load tasks:", error.message);
    return;
  }
  for (const row of (data ?? []) as TaskRow[]) {
    const due = isTimedReminderDue(
      {
        date: row.due_date,
        time: row.due_time,
        allDay: false,
        notifyMinutesBefore: row.notify_minutes_before,
        notifiedAt: row.notified_at,
      },
      nowMs,
    );
    if (!due) continue;
    const { error: updateError } = await supabase.from("tasks").update({ notified_at: nowMs }).eq("id", row.id);
    if (updateError) {
      console.error(`[checkRemindersAndNotify:tasks] failed to mark ${row.id} notified:`, updateError.message);
      continue;
    }
    await sendToUser(supabase, row.user_id, "tasks", buildTaskReminderPayload(row.title), "[checkRemindersAndNotify:tasks]");
  }
}

async function processFixedCosts(supabase: SupabaseClient, nowMs: number): Promise<void> {
  const { data, error } = await supabase
    .from("fixed_costs")
    .select("id, user_id, title, amount, due_day, active, notify_days_before, last_notified_month")
    .not("notify_days_before", "is", null)
    .eq("active", true);
  if (error) {
    console.error("[checkRemindersAndNotify:fixedCosts] failed to load fixed_costs:", error.message);
    return;
  }
  const { year, monthIndex0 } = jstYearMonth(nowMs);
  for (const row of (data ?? []) as FixedCostRow[]) {
    const forMonth = fixedCostReminderMonth(
      {
        dueDay: row.due_day,
        notifyDaysBefore: row.notify_days_before,
        lastNotifiedMonth: row.last_notified_month,
        active: row.active,
      },
      nowMs,
      year,
      monthIndex0,
    );
    if (!forMonth) continue;
    const { error: updateError } = await supabase.from("fixed_costs").update({ last_notified_month: forMonth }).eq("id", row.id);
    if (updateError) {
      console.error(`[checkRemindersAndNotify:fixedCosts] failed to mark ${row.id} notified:`, updateError.message);
      continue;
    }
    await sendToUser(
      supabase,
      row.user_id,
      "fixed_costs",
      buildFixedCostReminderPayload(row.title, row.amount, row.due_day),
      "[checkRemindersAndNotify:fixedCosts]",
    );
  }
}

const handlerImpl: Handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error("[checkRemindersAndNotify] missing required environment variables, skipping run");
    return { statusCode: 500, body: "not configured" };
  }

  setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const nowMs = Date.now();

  // 1つの種類で失敗しても、残りの種類は試す。
  for (const process of [processEvents, processTasks, processFixedCosts]) {
    try {
      await process(supabase, nowMs);
    } catch (err) {
      console.error(`[checkRemindersAndNotify] ${process.name} failed:`, err);
    }
  }

  return { statusCode: 200, body: "ok" };
};

/** 2分ごとに予定・タスクの時刻通知と、固定費の支払日リマインダーをチェックし、該当する
 * ユーザーへWeb Pushで送る。バックグラウンド通知を有効にした端末だけが対象
 * (src/lib/pushNotifications.tsのsubscribeToPush経由でpush_subscriptionsに存在する)。 */
export const handler = schedule("*/2 * * * *", handlerImpl);
