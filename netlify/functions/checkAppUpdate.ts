import { schedule, type Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { sendNotification, setVapidDetails, WebPushError } from "web-push";

/** Single fixed row id — app_version_state (supabase/sql/006) only ever holds one. */
const VERSION_STATE_ID = "singleton";

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  disabled_categories: string[] | null;
}

/** Same payload shape as checkGmailAndNotify.ts's buildNotificationPayload (both are
 * consumed by public/push-sw.js's single `push` handler) — kept pure/exported for the
 * same reason: unit-testable without a live push round trip. */
export function buildUpdateNotificationPayload(): string {
  return JSON.stringify({
    title: "LIFE HUBがアップデートされました",
    body: "タップすると最新版が開きます。",
    url: "/",
  });
}

/** Pure decision extracted out of the handler so it's unit-testable: notify only when
 * a *previously recorded* version differs from the one just fetched. `null` means "no
 * baseline recorded yet" — the very first run after this feature ships (or after the
 * app_version_state row is ever cleared), which must NOT notify: without this, turning
 * the feature on would immediately fire an "updated" push to everyone even though
 * nothing changed, simply because there was nothing to compare against yet. */
export function shouldNotify(previousVersion: string | null, deployedVersion: string): boolean {
  return previousVersion !== null && previousVersion !== deployedVersion;
}

/** Cache-busts with a query param since this is a plain static asset that a CDN could
 * otherwise serve stale for a while after a new deploy, which would delay detection
 * without ever being wrong (see the checkpoint-then-send ordering below for the
 * failure-mode this function actually has to guard against). */
async function fetchDeployedVersion(siteUrl: string): Promise<string | null> {
  const res = await fetch(`${siteUrl.replace(/\/$/, "")}/version.json?t=${Date.now()}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { version?: string };
  return data.version ?? null;
}

const handlerImpl: Handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  // Netlifyがビルド・実行時の両方に自動で注入する、このサイト自身の本番URL。
  const siteUrl = process.env.URL;

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject || !siteUrl) {
    console.error("[checkAppUpdate] missing required environment variables, skipping run");
    return { statusCode: 500, body: "not configured" };
  }

  setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const deployedVersion = await fetchDeployedVersion(siteUrl);
  if (!deployedVersion) {
    console.error("[checkAppUpdate] failed to read /version.json, skipping run");
    return { statusCode: 200, body: "no version" };
  }

  const { data: state, error: stateError } = await supabase
    .from("app_version_state")
    .select("version")
    .eq("id", VERSION_STATE_ID)
    .maybeSingle();
  if (stateError) {
    console.error("[checkAppUpdate] failed to read app_version_state:", stateError.message);
    return { statusCode: 500, body: stateError.message };
  }
  const previousVersion = (state as { version: string } | null)?.version ?? null;

  if (!shouldNotify(previousVersion, deployedVersion)) {
    // 初回実行時(previousVersion === null)はここで基準値を記録するだけに留める —
    // テーブルを作った直後の1回目からいきなり全員へ「アップデートしました」と誤通知しないため。
    if (previousVersion === null) {
      await supabase.from("app_version_state").upsert({ id: VERSION_STATE_ID, version: deployedVersion, updated_at: new Date().toISOString() });
      console.log(`[checkAppUpdate] first run, recording baseline version ${deployedVersion}`);
    }
    return { statusCode: 200, body: "no change" };
  }

  console.log(`[checkAppUpdate] version changed ${previousVersion} -> ${deployedVersion}, notifying`);
  // checkGmailAndNotify.tsと同じ理由で、送信の成否に関わらず先にチェックポイントを進める —
  // 送信ループが失敗・タイムアウトしても、古いバージョンのまま残って次回以降も
  // 同じ変化を検知して再通知し続ける、ということがないように。
  const { error: checkpointError } = await supabase
    .from("app_version_state")
    .upsert({ id: VERSION_STATE_ID, version: deployedVersion, updated_at: new Date().toISOString() });
  if (checkpointError) {
    console.error("[checkAppUpdate] failed to advance app_version_state:", checkpointError.message);
  }

  const { data: subs, error: subsError } = await supabase.from("push_subscriptions").select("*");
  if (subsError) {
    console.error("[checkAppUpdate] failed to load push_subscriptions:", subsError.message);
    return { statusCode: 500, body: subsError.message };
  }

  const payload = buildUpdateNotificationPayload();
  for (const sub of (subs ?? []) as PushSubscriptionRow[]) {
    if ((sub.disabled_categories ?? []).includes("app_update")) continue;
    try {
      await sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload);
    } catch (err) {
      if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
        // 購読切れ(ブラウザ側で解除済み) — このデバイスの購読情報を削除する
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        console.error("[checkAppUpdate] push send failed:", err);
      }
    }
  }

  return { statusCode: 200, body: "notified" };
};

/** 2分ごとにこのサイト自身の /version.json をポーリングし、デプロイで値が変わっていれば
 * 全端末(Gmail連携の有無を問わない、アプリ全体のお知らせ)へWeb Pushで通知する。
 * checkGmailAndNotify.tsと同じ周期・同じ理由(バックグラウンド通知を有効にしたユーザーのみ、
 * src/lib/pushNotifications.tsのsubscribeToPush経由でpush_subscriptionsに存在する)。 */
export const handler = schedule("*/2 * * * *", handlerImpl);
