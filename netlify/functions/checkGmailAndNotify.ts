import { schedule, type Handler } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendNotification, setVapidDetails, WebPushError } from "web-push";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_MESSAGES_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

interface GmailServerAccountRow {
  id: string;
  user_id: string;
  email: string;
  refresh_token: string;
  last_checked_at: string;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

interface LatestMessageMeta {
  from: string;
  subject: string;
}

/** Builds the JSON payload consumed by public/push-sw.js's `push` handler — kept
 * pure/exported so the notification-text logic is unit-testable without a live
 * Gmail/web-push round trip. */
export function buildNotificationPayload(newMessageCount: number, latest: LatestMessageMeta | null): string {
  const title = newMessageCount === 1 ? "新着メール" : `新着メール ${newMessageCount}件`;
  const body = latest ? `${latest.from}: ${latest.subject}` : "";
  return JSON.stringify({ title, body, url: "/gmail" });
}

async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string | null> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function findHeader(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Same after:{epoch} query shape as src/lib/gmail.ts's listRecentMessageIds.
 * Only fetches metadata (From/Subject) for the newest message — the notification
 * body doesn't need the full message content. */
async function checkForNewMail(accessToken: string, sinceEpochSec: number): Promise<{ count: number; latest: LatestMessageMeta | null }> {
  const listParams = new URLSearchParams({ q: `after:${sinceEpochSec}`, maxResults: "10" });
  const listRes = await fetch(`${GMAIL_MESSAGES_ENDPOINT}?${listParams.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) throw new Error(`Gmail messages.list failed: ${listRes.status}`);
  const listData = (await listRes.json()) as { messages?: { id: string }[] };
  const messages = listData.messages ?? [];
  if (messages.length === 0) return { count: 0, latest: null };

  const metaParams = new URLSearchParams({ format: "metadata" });
  metaParams.append("metadataHeaders", "From");
  metaParams.append("metadataHeaders", "Subject");
  const metaRes = await fetch(`${GMAIL_MESSAGES_ENDPOINT}/${messages[0].id}?${metaParams.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaRes.ok) return { count: messages.length, latest: null };
  const metaData = (await metaRes.json()) as { payload?: { headers?: { name: string; value: string }[] } };
  const headers = metaData.payload?.headers ?? [];
  return {
    count: messages.length,
    latest: { from: findHeader(headers, "From"), subject: findHeader(headers, "Subject") || "(件名なし)" },
  };
}

async function checkAccount(
  supabase: SupabaseClient,
  account: GmailServerAccountRow,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const accessToken = await refreshAccessToken(account.refresh_token, clientId, clientSecret);
  if (!accessToken) {
    // リフレッシュトークンが失効済み(連携解除・パスワード変更など) — このアカウントの監視を止める
    console.error(`[checkGmailAndNotify] refresh token invalid for ${account.email}, removing account`);
    await supabase.from("gmail_server_accounts").delete().eq("id", account.id);
    return;
  }

  const sinceEpochSec = Math.floor(new Date(account.last_checked_at).getTime() / 1000);
  const { count, latest } = await checkForNewMail(accessToken, sinceEpochSec);
  console.log(
    `[checkGmailAndNotify] ${account.email}: since=${new Date(sinceEpochSec * 1000).toISOString()} newMessages=${count}${latest ? ` latestFrom=${latest.from}` : ""}`,
  );

  if (count > 0) {
    const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("user_id", account.user_id);
    console.log(`[checkGmailAndNotify] ${account.email}: found ${subs?.length ?? 0} push subscription(s) for user ${account.user_id}`);
    const payload = buildNotificationPayload(count, latest);
    for (const sub of (subs ?? []) as PushSubscriptionRow[]) {
      try {
        await sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload);
        console.log(`[checkGmailAndNotify] push sent OK to ${sub.endpoint.slice(0, 60)}...`);
      } catch (err) {
        if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
          // 購読切れ(ブラウザ側で解除済み) — このデバイスの購読情報を削除する
          console.error(`[checkGmailAndNotify] subscription gone (${err.statusCode}), removing:`, sub.endpoint.slice(0, 60));
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error(`[checkGmailAndNotify] push send failed for ${account.email}:`, err);
        }
      }
    }
  }

  await supabase.from("gmail_server_accounts").update({ last_checked_at: new Date().toISOString() }).eq("id", account.id);
}

const handlerImpl: Handler = async () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;

  if (!clientId || !clientSecret || !supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error("[checkGmailAndNotify] missing required environment variables, skipping run");
    return { statusCode: 500, body: "not configured" };
  }

  setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  // service_role キーでRLSを越え、全ユーザー分の gmail_server_accounts を読む(この関数専用の用途)。
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: accounts, error } = await supabase.from("gmail_server_accounts").select("*");
  if (error) {
    console.error("[checkGmailAndNotify] failed to load gmail_server_accounts:", error.message);
    return { statusCode: 500, body: error.message };
  }
  console.log(`[checkGmailAndNotify] run start: ${accounts?.length ?? 0} account(s) registered`);

  for (const account of (accounts ?? []) as GmailServerAccountRow[]) {
    try {
      await checkAccount(supabase, account, clientId, clientSecret);
    } catch (err) {
      console.error(`[checkGmailAndNotify] failed for account ${account.email}:`, err);
    }
  }

  return { statusCode: 200, body: "ok" };
};

/** 10分ごとに全ユーザーのGmailをポーリングし、新着があればWeb Pushで通知する。
 * バックグラウンド通知を有効にしたユーザーだけ(src/lib/pushNotifications.tsのsubscribeToPush経由で)
 * refresh_tokenがgmail_server_accountsに存在する — それ以外は対象外。 */
export const handler = schedule("*/10 * * * *", handlerImpl);
