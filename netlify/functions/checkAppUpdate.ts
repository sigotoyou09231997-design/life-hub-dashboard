import { schedule, type Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { sendNotification, setVapidDetails, WebPushError } from "web-push";

/** 最後に「アップデートされました」を送った版（supabase/sql/006 の app_version_state）。 */
const VERSION_STATE_ID = "singleton";
/**
 * いちばん新しく見つけた版と、それを見つけた時刻（updated_at）。2026-10-12 に足した2行目。
 * 表は id が主キーなだけで1行に限ってはいないので、列を足さず（SQL を流さず）に持てる。
 */
const LATEST_STATE_ID = "latest";

/**
 * 2026-10-12、本人「アップデートの通知が何回も来るから一回にまとめて欲しい」。
 * 前は版が変わるたび（2分ごとに確認）に全端末へ送っていたので、1晩に十数回出すと十数回届いていた。
 * いまは、出し終わって UPDATE_QUIET_MS のあいだ次が来なかった時に、まとめて1回だけ送る。
 * 夜（日本時間 22時〜7時）は送らずに朝まで持ち越す。
 */
export const UPDATE_QUIET_MS = 40 * 60_000;
const NIGHT_START_HOUR_JST = 22;
const NIGHT_END_HOUR_JST = 7;

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

/** 日本時間で夜（送らない時間帯）か。サーバーの時差設定に頼らず UTC+9 で数える。 */
export function isNightJst(now: number): boolean {
  const hour = new Date(now + 9 * 60 * 60_000).getUTCHours();
  return hour >= NIGHT_START_HOUR_JST || hour < NIGHT_END_HOUR_JST;
}

export interface VersionMark {
  version: string;
  /** その版を記録した時刻（ミリ秒）。 */
  at: number;
}

/**
 * 2分ごとの実行で何をするか。テストできるように、処理から切り離した純粋な判断。
 *  - baseline … 初めての実行。基準を記録するだけで送らない（機能を入れた直後に全員へ誤通知しないため）
 *  - track    … 新しい版を見つけた。「見つけた時刻」を記録し直して、静かになるのを待ち始める
 *  - wait     … 送っていない版があるが、まだ次が来るかもしれない（40分たっていない）か、夜
 *  - idle     … 送るものが無い
 *  - notify   … まとめて1回送る
 */
export type UpdatePushDecision = "baseline" | "track" | "wait" | "idle" | "notify";

export function decideUpdatePush(
  notifiedVersion: string | null,
  latest: VersionMark | null,
  deployedVersion: string,
  now: number,
): UpdatePushDecision {
  if (notifiedVersion === null) return "baseline";
  if (!latest || latest.version !== deployedVersion) return "track";
  if (deployedVersion === notifiedVersion) return "idle";
  if (now - latest.at < UPDATE_QUIET_MS) return "wait";
  if (isNightJst(now)) return "wait";
  return "notify";
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

  const { data: rows, error: stateError } = await supabase
    .from("app_version_state")
    .select("id, version, updated_at")
    .in("id", [VERSION_STATE_ID, LATEST_STATE_ID]);

  if (stateError) {
    console.error("[checkAppUpdate] failed to read app_version_state:", stateError.message);
    return { statusCode: 500, body: stateError.message };
  }

  const stateRows = (rows ?? []) as { id: string; version: string; updated_at: string }[];
  const notifiedRow = stateRows.find((row) => row.id === VERSION_STATE_ID);
  const latestRow = stateRows.find((row) => row.id === LATEST_STATE_ID);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const decision = decideUpdatePush(
    notifiedRow?.version ?? null,
    latestRow ? { version: latestRow.version, at: Date.parse(latestRow.updated_at) } : null,
    deployedVersion,
    now,
  );

  if (decision === "baseline") {
    // テーブルを作った直後の1回目からいきなり全員へ「アップデートしました」と誤通知しないため、記録だけ。
    await supabase.from("app_version_state").upsert([
      { id: VERSION_STATE_ID, version: deployedVersion, updated_at: nowIso },
      { id: LATEST_STATE_ID, version: deployedVersion, updated_at: nowIso },
    ]);
    console.log(`[checkAppUpdate] first run, recording baseline version ${deployedVersion}`);
    return { statusCode: 200, body: "baseline" };
  }
  if (decision === "track") {
    await supabase.from("app_version_state").upsert({ id: LATEST_STATE_ID, version: deployedVersion, updated_at: nowIso });
    console.log(`[checkAppUpdate] new version ${deployedVersion}, waiting until releases go quiet`);
    return { statusCode: 200, body: "tracking" };
  }
  if (decision !== "notify") return { statusCode: 200, body: decision };

  console.log(`[checkAppUpdate] version changed ${notifiedRow?.version} -> ${deployedVersion}, notifying once`);

  // checkGmailAndNotify.tsと同じ理由で、送信の成否に関わらず先にチェックポイントを進める —
  // 送信ループが失敗・タイムアウトしても、古いバージョンのまま残って次回以降も
  // 同じ変化を検知して再通知し続ける、ということがないように。
  const { error: checkpointError } = await supabase
    .from("app_version_state")
    .upsert({ id: VERSION_STATE_ID, version: deployedVersion, updated_at: nowIso });
  if (checkpointError) {
    console.error("[checkAppUpdate] failed to advance app_version_state:", checkpointError.message);
    // 進められなかったまま送ると、次の2分後にもう一度送ってしまう（まとめた意味が無くなる）。
    return { statusCode: 500, body: checkpointError.message };
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
 * 続けて出した時は、静かになってから1回にまとめる（上の decideUpdatePush）。
 * checkGmailAndNotify.tsと同じ周期・同じ理由(バックグラウンド通知を有効にしたユーザーのみ、
 * src/lib/pushNotifications.tsのsubscribeToPush経由でpush_subscriptionsに存在する)。 */
export const handler = schedule("*/2 * * * *", handlerImpl);
