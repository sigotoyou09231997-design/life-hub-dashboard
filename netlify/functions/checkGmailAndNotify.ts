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
  snippet: string;
}

interface FetchedMessageMeta extends LatestMessageMeta {
  /** Gmail's internalDate (epoch ms) — see the comment in checkForNewMail for why
   * this, not the after: query, is treated as the authoritative "is it new" check. */
  internalDateMs: number;
}

/** Extracts just the display name from a "From" header ("\"Name\" <email>" or a bare
 * address) — same shape as src/lib/gmail.ts's parseSender, duplicated here since
 * Netlify Functions bundle separately from the app's client code. */
function parseSenderName(from: string): string {
  const match = from.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  if (match) return match[1].trim() || match[2].trim();
  return from.trim();
}

/** Extracts just the email address from a "From" header, lowercased so it can be
 * compared against blocked_senders rows (which are stored lowercased by
 * src/lib/blockedSenders.ts, matching the local db.blockedSenders convention). */
export function parseSenderEmail(from: string): string {
  const match = from.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  const email = match ? match[2].trim() : from.trim();
  return email.toLowerCase();
}

/** Builds the JSON payload consumed by public/push-sw.js's `push` handler — kept
 * pure/exported so the notification-text logic is unit-testable without a live
 * Gmail/web-push round trip. Title is the sender so it's visible even collapsed;
 * body carries the subject + a content preview (Gmail's own snippet field). */
export function buildNotificationPayload(newMessageCount: number, latest: LatestMessageMeta | null): string {
  if (!latest) {
    const title = newMessageCount === 1 ? "新着メール" : `新着メール ${newMessageCount}件`;
    return JSON.stringify({ title, body: "", url: "/gmail" });
  }
  const senderName = parseSenderName(latest.from);
  const title = newMessageCount === 1 ? senderName : `${senderName} 他${newMessageCount - 1}件`;
  const body = [`件名: ${latest.subject}`, latest.snippet].filter(Boolean).join("\n");
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

async function fetchMessageMeta(accessToken: string, messageId: string): Promise<FetchedMessageMeta | null> {
  const metaParams = new URLSearchParams({ format: "metadata" });
  metaParams.append("metadataHeaders", "From");
  metaParams.append("metadataHeaders", "Subject");
  const metaRes = await fetch(`${GMAIL_MESSAGES_ENDPOINT}/${messageId}?${metaParams.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaRes.ok) return null;
  const metaData = (await metaRes.json()) as {
    snippet?: string;
    internalDate?: string;
    payload?: { headers?: { name: string; value: string }[] };
  };
  const headers = metaData.payload?.headers ?? [];
  return {
    from: findHeader(headers, "From"),
    subject: findHeader(headers, "Subject") || "(件名なし)",
    snippet: metaData.snippet ?? "",
    internalDateMs: Number(metaData.internalDate ?? 0),
  };
}

/** Same after:{epoch} query shape as src/lib/gmail.ts's listRecentMessageIds.
 * Fetches metadata (From/Subject, Gmail already includes `snippet` on a
 * metadata-format response) for every candidate message — not just the newest —
 * so messages from a blocked sender can be excluded before counting/picking the
 * "latest" one for the notification.
 *
 * Gmail's after: search operator is not reliably second-precise — it can still
 * resurface a message received earlier than sinceEpochSec (this codebase already
 * works around the same behavior elsewhere: src/lib/gmail.ts's
 * threadHasSentReplyAfter re-checks internalDate in code rather than trusting a
 * query-level date filter). Since this function has no other way to remember
 * which messages it already notified about — unlike the client's manual sync in
 * GmailInbox.tsx, which dedupes against locally-stored message IDs — a stale
 * resurfaced message here goes straight to a push notification. So internalDate
 * (an exact per-message timestamp, always present regardless of `format`) is
 * re-checked here as the authoritative cutoff; the query-level after: filter is
 * only a cheap pre-filter to keep the candidate list small. A message whose
 * metadata (and therefore internalDate) couldn't be fetched is dropped rather
 * than optimistically counted, since we can no longer confirm it's actually new. */
export async function checkForNewMail(
  accessToken: string,
  sinceEpochSec: number,
  blockedEmails: Set<string>,
): Promise<{ count: number; latest: LatestMessageMeta | null }> {
  // in:inbox を付けないと、Gmail検索のデフォルト範囲(受信トレイ+送信済み)により、この
  // アプリ自身が送信した返信(送信済みフォルダ行き)まで「新着メール」として拾ってしまう。
  const listParams = new URLSearchParams({ q: `in:inbox after:${sinceEpochSec}`, maxResults: "10" });
  const listRes = await fetch(`${GMAIL_MESSAGES_ENDPOINT}?${listParams.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) throw new Error(`Gmail messages.list failed: ${listRes.status}`);
  const listData = (await listRes.json()) as { messages?: { id: string }[] };
  const messages = listData.messages ?? [];
  if (messages.length === 0) return { count: 0, latest: null };

  const metas = await Promise.all(messages.map((m) => fetchMessageMeta(accessToken, m.id)));
  const sinceEpochMs = sinceEpochSec * 1000;
  const actuallyNew = metas.filter((meta): meta is FetchedMessageMeta => meta !== null && meta.internalDateMs > sinceEpochMs);
  const visible = actuallyNew.filter((meta) => !blockedEmails.has(parseSenderEmail(meta.from)));
  const latest = visible[0] ?? null;
  return { count: visible.length, latest };
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

  // ブロック済み送信者(src/lib/blockedSenders.tsがブロック/解除のたびに直接upsert/deleteする、
  // アカウント単位のブロックリスト)を読み、そこからのメールは通知の対象外にする。テーブルが
  // まだ存在しない場合(SQLをまだ実行していない環境)はエラーを無視して「ブロックなし」扱いにする。
  const { data: blocked, error: blockedError } = await supabase
    .from("blocked_senders")
    .select("sender_email")
    .eq("user_id", account.user_id)
    .eq("account_email", account.email);
  if (blockedError) {
    console.error(`[checkGmailAndNotify] failed to load blocked_senders for ${account.email}:`, blockedError.message);
  }
  const blockedEmails = new Set(((blocked ?? []) as { sender_email: string }[]).map((b) => b.sender_email.toLowerCase()));

  const sinceEpochSec = Math.floor(new Date(account.last_checked_at).getTime() / 1000);
  const { count, latest } = await checkForNewMail(accessToken, sinceEpochSec, blockedEmails);
  console.log(
    `[checkGmailAndNotify] ${account.email}: since=${new Date(sinceEpochSec * 1000).toISOString()} newMessages=${count}${latest ? ` latestFrom=${latest.from}` : ""}`,
  );

  // 新着の有無・プッシュ送信の成否に関わらず、ここで先にチェックポイントを進めておく。
  // 以前はプッシュ送信の"後"に更新していたため、送信ループが失敗・タイムアウトした場合に
  // last_checked_atが古いまま残り、次回(2分後)のポーリングで同じメールを何度も「新着」
  // として再検出・再通知してしまっていた(ユーザー体感では「新着が来てないのに通知が来る」)。
  // この更新自体の失敗もエラーを握りつぶさず記録し、一度だけ再試行する。
  const checkedAt = new Date().toISOString();
  let { error: checkpointError } = await supabase.from("gmail_server_accounts").update({ last_checked_at: checkedAt }).eq("id", account.id);
  if (checkpointError) {
    console.error(`[checkGmailAndNotify] failed to advance last_checked_at for ${account.email}, retrying once:`, checkpointError.message);
    ({ error: checkpointError } = await supabase.from("gmail_server_accounts").update({ last_checked_at: checkedAt }).eq("id", account.id));
    if (checkpointError) {
      console.error(`[checkGmailAndNotify] retry also failed for ${account.email}:`, checkpointError.message);
    }
  }

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

/** 2分ごとに全ユーザーのGmailをポーリングし、新着があればWeb Pushで通知する(最悪ケースで検知まで
 * 2分弱の遅延)。バックグラウンド通知を有効にしたユーザーだけ(src/lib/pushNotifications.tsの
 * subscribeToPush経由で)refresh_tokenがgmail_server_accountsに存在する — それ以外は対象外。 */
export const handler = schedule("*/2 * * * *", handlerImpl);
