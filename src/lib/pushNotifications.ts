import { auth, isSupabaseConfigured } from "./supabase";
import { getSupabaseDataClient } from "./supabaseData";
import { getDeviceId } from "./deviceId";
import type { GmailAccount } from "../types";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "";

/** True once VITE_VAPID_PUBLIC_KEY is set — lets the UI hide the background-notification
 * toggle entirely on deployments that haven't configured Web Push yet. */
export const isPushConfigured = Boolean(VAPID_PUBLIC_KEY);

/** PushManager.subscribe wants a raw BufferSource, not the base64url string Web Push
 * tooling hands out — this is the standard conversion (matches the MDN/web.dev recipe).
 * Built via `new Uint8Array(length)` + index assignment rather than `Uint8Array.from`
 * so the result stays typed as `Uint8Array<ArrayBuffer>` (what `BufferSource` wants) —
 * `.from()` infers the wider `ArrayBufferLike`, which TS 5.7 no longer accepts there. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** Subscribes this device to Web Push and upserts (1) the subscription itself and
 * (2) every currently-connected Gmail account's refresh token into Supabase, so
 * netlify/functions/checkGmailAndNotify.ts can poll on this user's behalf while the
 * app is closed. Requires an active Supabase-Auth session (same login as PC/スマホ同期,
 * not a new auth system) — the caller is expected to gate on `session` already existing. */
export async function subscribeToPush(accounts: GmailAccount[], userId: string): Promise<void> {
  if (!isPushConfigured) throw new Error("バックグラウンド通知が設定されていません");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("この端末・ブラウザはプッシュ通知に対応していません");
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("プッシュ購読情報の取得に失敗しました");
  }

  const supabase = await getSupabaseDataClient();
  const { error: subError } = await supabase.from("push_subscriptions").upsert(
    {
      id: crypto.randomUUID(),
      user_id: userId,
      device_id: getDeviceId(),
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth_key: json.keys.auth,
    },
    { onConflict: "endpoint" },
  );
  if (subError) throw subError;

  if (accounts.length > 0) {
    const { error: accountsError } = await supabase.from("gmail_server_accounts").upsert(
      accounts.map((account) => ({
        id: crypto.randomUUID(),
        user_id: userId,
        email: account.email,
        refresh_token: account.refreshToken,
      })),
      { onConflict: "user_id,email" },
    );
    if (accountsError) throw accountsError;
  }
}

/** Hands a just-(re)connected Gmail account's refresh token to the server-side poll
 * (netlify/functions/checkGmailAndNotify.ts), so background 新着メール notifications
 * survive a reconnection.
 *
 * Without this, notifications stop for good the first time Google's refresh token
 * expires — which happens routinely, every 7 days, while the OAuth consent screen is
 * still "testing" (see the comment on describeSyncError in src/lib/gmailSync.ts):
 *   1. the token dies; the app's own sync starts failing and GmailPage shows the
 *      「つなぎ直す」 banner,
 *   2. checkGmailAndNotify.ts fails on the same dead token and deletes the
 *      gmail_server_accounts row,
 *   3. the user reconnects — but that only wrote the new refresh token into the local
 *      Dexie row (src/pages/GmailCallbackPage.tsx), so the inbox fills up again while
 *      the server has no token at all and never sends another notification.
 * The only thing that used to re-register it was toggling バックグラウンド通知 off and
 * back on in 設定 (subscribeToPush above) — which nothing tells the user to do.
 *
 * Only stores the token if this user actually uses background notifications: the check
 * is on push_subscriptions for the whole user (not just this device), since 通知を
 * 有効にした端末 and つなぎ直した端末 can be different ones.
 *
 * `last_checked_at` is moved to now on purpose. Notifications should resume from the
 * reconnection, not replay whatever arrived while the link was broken (that would be a
 * burst of notifications for mail the inbox is about to show anyway).
 *
 * Best-effort: reports failures to the console instead of throwing, so a reconnection
 * still counts as successful when only this extra step couldn't be completed. */
export async function registerGmailAccountForPush(account: Pick<GmailAccount, "email" | "refreshToken">): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { data: sessionData } = await auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return;

  const supabase = await getSupabaseDataClient();
  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (subsError) {
    console.error("[push] failed to check for existing push subscriptions:", subsError.message);
    return;
  }
  if ((subs ?? []).length === 0) return;

  const { error } = await supabase.from("gmail_server_accounts").upsert(
    {
      id: crypto.randomUUID(),
      user_id: userId,
      email: account.email,
      refresh_token: account.refreshToken,
      last_checked_at: new Date().toISOString(),
    },
    { onConflict: "user_id,email" },
  );
  if (error) console.error("[push] failed to register the reconnected Gmail account for notifications:", error.message);
}

/** Closes any OS notifications from this app still sitting open on this device
 * (e.g. Gmail push notifications not yet tapped/dismissed) — called on app load so
 * stale notifications (including ones from a sender blocked after they were sent)
 * don't linger once the user has actually opened the app and can see the inbox
 * directly. Uses `getRegistration()` rather than `navigator.serviceWorker.ready`,
 * which never resolves if no service worker is registered (e.g. local dev). */
export async function clearShownPushNotifications(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  const notifications = await registration.getNotifications();
  notifications.forEach((notification) => notification.close());
}

/** Removes only this device's push subscription (both locally and in Supabase).
 * Deliberately leaves gmail_server_accounts untouched — another device's subscription
 * may still rely on it; that table is cleaned up per-account when a Gmail account is
 * fully disconnected in SettingsPage instead (handleDisconnectGmail). */
export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getPushSubscription();
  if (!subscription) return;
  const supabase = await getSupabaseDataClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  await subscription.unsubscribe();
}

/** バックグラウンド通知の種類。checkGmailAndNotify.ts/checkAppUpdate.ts/
 * checkRemindersAndNotify.ts/checkBudgetAndNotify.tsが、この端末の購読
 * (push_subscriptions.disabled_categories)に含まれる種類だけ送信を飛ばす。 */
export const NOTIFICATION_CATEGORIES = [
  { key: "gmail", label: "Gmailの新着" },
  { key: "app_update", label: "アプリの更新" },
  { key: "events", label: "予定" },
  { key: "tasks", label: "タスクの期限" },
  { key: "fixed_costs", label: "固定費の支払日" },
  { key: "budget", label: "使いすぎ・予算オーバー" },
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]["key"];

/** この端末の購読で止めているカテゴリ。まだ購読していなければ空(=すべて有効)を返す。 */
export async function getDisabledCategories(): Promise<Set<NotificationCategory>> {
  const subscription = await getPushSubscription();
  if (!subscription) return new Set();
  const supabase = await getSupabaseDataClient();
  const { data } = await supabase
    .from("push_subscriptions")
    .select("disabled_categories")
    .eq("endpoint", subscription.endpoint)
    .maybeSingle();
  return new Set(((data as { disabled_categories: string[] | null } | null)?.disabled_categories ?? []) as NotificationCategory[]);
}

/** この端末で止めるカテゴリを丸ごと置き換える。 */
export async function setDisabledCategories(categories: NotificationCategory[]): Promise<void> {
  const subscription = await getPushSubscription();
  if (!subscription) return;
  const supabase = await getSupabaseDataClient();
  await supabase.from("push_subscriptions").update({ disabled_categories: categories }).eq("endpoint", subscription.endpoint);
}
