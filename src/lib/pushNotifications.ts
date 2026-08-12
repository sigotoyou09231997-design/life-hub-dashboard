import { supabase } from "./supabase";
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

/** Removes only this device's push subscription (both locally and in Supabase).
 * Deliberately leaves gmail_server_accounts untouched — another device's subscription
 * may still rely on it; that table is cleaned up per-account when a Gmail account is
 * fully disconnected in SettingsPage instead (handleDisconnectGmail). */
export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getPushSubscription();
  if (!subscription) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  await subscription.unsubscribe();
}
