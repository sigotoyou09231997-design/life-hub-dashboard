import { schedule, type Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { sendNotification, setVapidDetails, WebPushError } from "web-push";

/**
 * 修正依頼(要望の受信箱、supabase/sql/029_app_feedback.sql)が届いたら、持ち主の端末へ
 * Web Push で知らせる(2026-10-12、本人「修正依頼が来たら通知が来るようにできない」)。
 *
 * どこまで知らせたかは app_version_state(006、service_role だけが読み書きする1行ずつの表)の
 * 1行に、最後に知らせた依頼の届いた時刻(created_at、ISO)として持つ。表の名前は版のためのものだが、
 * 「名前つきで値を1つ覚える」作りなので、新しい SQL を流さずに済むようにここを借りる。
 *
 * - 初めての実行は、今の時刻を記録するだけで送らない(今までに届いた分をまとめて知らせない)。
 * - 夜(日本時間 22〜7 時)は送らずに待ち、朝になってから、その間に届いた分を1回で知らせる
 *   (アプリの更新の通知と同じ時間帯。checkAppUpdate.ts)。
 * - 持ち主が自分で送ったものは知らせない。
 * - 知らせるのは持ち主の端末だけ(push_subscriptions.user_id)。通知の設定で「修正依頼」を
 *   止めた端末には送らない。
 *
 * 依頼の中身はほかの人が書いた文章なので、通知には先頭だけを文字として出す(何かを実行しない)。
 */

const STATE_ID = "feedback_notified";
const CATEGORY = "feedback";
const NIGHT_START_HOUR_JST = 22;
const NIGHT_END_HOUR_JST = 7;
/** 通知の本文に出す依頼の文字数。ロック画面で2行ほどに収まる長さ。 */
const PREVIEW_CHARS = 60;

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  disabled_categories: string[] | null;
}

export interface FeedbackForNotice {
  message: string;
  sender_name: string | null;
  trip_name: string | null;
  via: "app" | "share";
}

/** 日本時間で夜(送らない時間帯)か。サーバーの時差設定に頼らず UTC+9 で数える。 */
export function isNightJst(now: number): boolean {
  const hour = new Date(now + 9 * 60 * 60_000).getUTCHours();
  return hour >= NIGHT_START_HOUR_JST || hour < NIGHT_END_HOUR_JST;
}

/** 誰から来たかの短い言い方。名前が無ければ、共有したしおりからか、アプリからかだけ。 */
function senderLabel(item: FeedbackForNotice): string {
  const name = item.sender_name?.trim();
  if (name) return name;
  if (item.via === "share") return item.trip_name?.trim() ? `しおり「${item.trip_name.trim()}」から` : "しおりから";
  return "アプリから";
}

function preview(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

/** 通知の中身(checkAppUpdate.ts と同じ形)。何件かまとめて届いた時は、いちばん新しいものの先頭を出す。 */
export function buildFeedbackNotificationPayload(items: FeedbackForNotice[]): string {
  const latest = items[items.length - 1];
  return JSON.stringify({
    title: items.length > 1 ? `修正依頼が${items.length}件届きました` : "修正依頼が届きました",
    body: latest ? `${senderLabel(latest)}: ${preview(latest.message)}` : "設定の「届いた要望」で読めます。",
    url: "/settings",
  });
}

const handlerImpl: Handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error("[checkFeedbackAndNotify] missing required environment variables, skipping run");
    return { statusCode: 500, body: "not configured" };
  }
  setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: owner, error: ownerError } = await supabase
    .from("app_feedback_owner")
    .select("user_id")
    .eq("id", "owner")
    .maybeSingle();
  if (ownerError) {
    console.error("[checkFeedbackAndNotify] failed to read the owner:", ownerError.message);
    return { statusCode: 500, body: ownerError.message };
  }
  const ownerId = (owner as { user_id?: string } | null)?.user_id;
  if (!ownerId) return { statusCode: 200, body: "no owner" };

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const { data: state, error: stateError } = await supabase
    .from("app_version_state")
    .select("version")
    .eq("id", STATE_ID)
    .maybeSingle();
  if (stateError) {
    console.error("[checkFeedbackAndNotify] failed to read app_version_state:", stateError.message);
    return { statusCode: 500, body: stateError.message };
  }
  const cursor = (state as { version?: string } | null)?.version;
  if (!cursor) {
    await supabase.from("app_version_state").upsert({ id: STATE_ID, version: nowIso, updated_at: nowIso });
    console.log("[checkFeedbackAndNotify] first run, recording baseline");
    return { statusCode: 200, body: "baseline" };
  }
  if (isNightJst(now)) return { statusCode: 200, body: "night" };

  const { data: rows, error: rowsError } = await supabase
    .from("app_feedback")
    .select("message, sender_name, trip_name, via, sender_id, created_at")
    .gt("created_at", cursor)
    .order("created_at", { ascending: true })
    .limit(50);
  if (rowsError) {
    console.error("[checkFeedbackAndNotify] failed to read app_feedback:", rowsError.message);
    return { statusCode: 500, body: rowsError.message };
  }
  const fetched = (rows ?? []) as (FeedbackForNotice & { sender_id: string | null; created_at: string })[];
  if (fetched.length === 0) return { statusCode: 200, body: "idle" };

  // 送る前にどこまで見たかを進める(checkAppUpdate.ts と同じ) — 送信が途中で失敗しても、
  // 同じ依頼を次の回にまた知らせ続けないように。
  const newest = fetched[fetched.length - 1].created_at;
  const { error: checkpointError } = await supabase
    .from("app_version_state")
    .upsert({ id: STATE_ID, version: newest, updated_at: nowIso });
  if (checkpointError) {
    console.error("[checkFeedbackAndNotify] failed to advance the checkpoint:", checkpointError.message);
    return { statusCode: 500, body: checkpointError.message };
  }

  const fromOthers = fetched.filter((item) => item.sender_id !== ownerId);
  if (fromOthers.length === 0) return { statusCode: 200, body: "own only" };

  const { data: subs, error: subsError } = await supabase.from("push_subscriptions").select("*").eq("user_id", ownerId);
  if (subsError) {
    console.error("[checkFeedbackAndNotify] failed to load push_subscriptions:", subsError.message);
    return { statusCode: 500, body: subsError.message };
  }

  const payload = buildFeedbackNotificationPayload(fromOthers);
  for (const sub of (subs ?? []) as PushSubscriptionRow[]) {
    if ((sub.disabled_categories ?? []).includes(CATEGORY)) continue;
    try {
      await sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload);
    } catch (err) {
      if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
        // 購読切れ(ブラウザ側で解除済み) — この端末の購読情報を消す
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        console.error("[checkFeedbackAndNotify] push send failed:", err);
      }
    }
  }
  console.log(`[checkFeedbackAndNotify] notified the owner about ${fromOthers.length} request(s)`);
  return { statusCode: 200, body: "notified" };
};

/** 5分ごと。修正依頼は急ぎではないので、Gmail(2分)より間を空けて実行の回数を抑える。 */
export const handler = schedule("*/5 * * * *", handlerImpl);
