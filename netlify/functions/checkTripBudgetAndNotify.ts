import { schedule, type Handler } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendNotification, setVapidDetails, WebPushError } from "web-push";

/** push_subscriptions.disabled_categoriesに入り得る値のうち、この関数が担当する種類
 * (src/lib/pushNotifications.tsのNOTIFICATION_CATEGORIESと同じ文字列)。
 * 家計のカテゴリ予算(checkBudgetAndNotify.ts の "budget")とは別にしてある —
 * 旅行中だけ鳴るものなので、家計の通知とは別に止められる方がよい。 */
const CATEGORY = "trip_budget";

/** 予算のこの割合に届いたら知らせる。超えてからでは使い方を変えられないので、
 * 「近づいた」でも1回出す(依頼の「近づいた/超えた」)。 */
export const TRIP_BUDGET_WARN_RATIO = 0.8;

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  disabled_categories: string[] | null;
}

export interface TripRow {
  id: string;
  user_id: string;
  name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  budget: number | null;
}

// このアプリは個人利用の日本語専用アプリという前提(CLAUDE.md)。日付はすべて端末の
// ローカル時刻のままタイムゾーン情報を持たずに保存されているため、
// checkBudgetAndNotify.tsと同じ割り切りでJST固定として扱う。
const JST_OFFSET_MS = 9 * 60 * 60_000;

/** nowMsをJSTの壁時計として見た日付(YYYY-MM-DD)。 */
export function jstTodayStr(nowMs: number): string {
  return new Date(nowMs + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 知らせる対象の旅行か。
 *
 * 予算を決めていない旅行は対象外(依頼のとおり)。まだ終わっていない旅行だけを見る —
 * 終わった旅行に「使いすぎです」と言っても、もう使い方を変えられない。始まる前の
 * 旅行は含める(予約や前払いで先に予算を食うことがあるため)。
 */
export function isTripInScope(trip: Pick<TripRow, "budget" | "end_date">, today: string): boolean {
  return typeof trip.budget === "number" && trip.budget > 0 && trip.end_date >= today;
}

export type TripBudgetLevel = "over" | "near" | "ok";

/** 使った額が予算に対してどの状態か。 */
export function tripBudgetLevel(spent: number, budget: number): TripBudgetLevel {
  if (budget <= 0) return "ok";
  if (spent > budget) return "over";
  if (spent >= budget * TRIP_BUDGET_WARN_RATIO) return "near";
  return "ok";
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

export function buildTripBudgetPayload(
  tripName: string,
  tripId: string,
  spent: number,
  budget: number,
  level: Exclude<TripBudgetLevel, "ok">,
): string {
  const title =
    level === "over"
      ? `${tripName}の予算を ${yen(spent - budget)} 超えました`
      : `${tripName}の予算が残り ${yen(budget - spent)} です`;
  return JSON.stringify({
    title,
    body: `予算 ${yen(budget)} のうち ${yen(spent)} を使いました。`,
    url: `/trips/${tripId}`,
  });
}

async function sendToUser(supabase: SupabaseClient, subs: PushSubscriptionRow[], payload: string): Promise<void> {
  for (const sub of subs) {
    if ((sub.disabled_categories ?? []).includes(CATEGORY)) continue;
    try {
      await sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload);
    } catch (err) {
      if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
        // 購読切れ(ブラウザ側で解除済み) — このデバイスの購読情報を削除する
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        console.error("[checkTripBudgetAndNotify] push send failed:", err);
      }
    }
  }
}

async function processUser(
  supabase: SupabaseClient,
  userId: string,
  subs: PushSubscriptionRow[],
  today: string,
): Promise<void> {
  const { data: tripRows, error: tripError } = await supabase
    .from("trips")
    .select("id, user_id, name, start_date, end_date, budget")
    .eq("user_id", userId)
    .gte("end_date", today)
    .is("deleted_at", null);
  if (tripError) {
    console.error(`[checkTripBudgetAndNotify] failed to load trips for ${userId}:`, tripError.message);
    return;
  }

  const trips = ((tripRows ?? []) as TripRow[]).filter((trip) => isTripInScope(trip, today));
  if (trips.length === 0) return;

  const { data: expenseRows, error: expenseError } = await supabase
    .from("trip_expenses")
    .select("trip_id, amount")
    .eq("user_id", userId)
    .in(
      "trip_id",
      trips.map((trip) => trip.id),
    )
    .is("deleted_at", null);
  if (expenseError) {
    console.error(`[checkTripBudgetAndNotify] failed to load trip_expenses for ${userId}:`, expenseError.message);
    return;
  }

  const spentByTrip = new Map<string, number>();
  for (const row of (expenseRows ?? []) as { trip_id: string; amount: number }[]) {
    spentByTrip.set(row.trip_id, (spentByTrip.get(row.trip_id) ?? 0) + Number(row.amount));
  }

  for (const trip of trips) {
    const spent = spentByTrip.get(trip.id) ?? 0;
    const level = tripBudgetLevel(spent, trip.budget!);
    if (level === "ok") continue;
    await sendToUser(supabase, subs, buildTripBudgetPayload(trip.name, trip.id, spent, trip.budget!, level));
  }
}

const handlerImpl: Handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error("[checkTripBudgetAndNotify] missing required environment variables, skipping run");
    return { statusCode: 500, body: "not configured" };
  }

  setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const today = jstTodayStr(Date.now());

  const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
  if (error) {
    console.error("[checkTripBudgetAndNotify] failed to load push_subscriptions:", error.message);
    return { statusCode: 500, body: error.message };
  }

  const byUser = new Map<string, PushSubscriptionRow[]>();
  for (const sub of (subs ?? []) as PushSubscriptionRow[]) {
    // この種類を止めている端末しか無いユーザーは、集計そのものを省く。
    if ((sub.disabled_categories ?? []).includes(CATEGORY)) continue;
    const list = byUser.get(sub.user_id) ?? [];
    list.push(sub);
    byUser.set(sub.user_id, list);
  }

  for (const [userId, userSubs] of byUser) {
    try {
      await processUser(supabase, userId, userSubs, today);
    } catch (err) {
      console.error(`[checkTripBudgetAndNotify] failed for ${userId}:`, err);
    }
  }

  return { statusCode: 200, body: "ok" };
};

/**
 * 1日1回(JST 18:00)、まだ終わっていない旅行の支出が予算に近づいた/超えたかを見て、
 * そうなっていればWeb Pushで知らせる。
 *
 * checkBudgetAndNotify.tsと同じ理由で1日1回にしてある — 使った額は増えるたびに
 * 変わるので、都度送ると鳴りすぎる。「通知済み」の印をどこにも持たないので
 * (テーブルを増やさずに済む)、当てはまる間は毎日1回鳴る。時刻を夕方にしたのは、
 * 旅行中はその日の夕食や買い物を決める前に気づけた方がよいため。
 */
export const handler = schedule("0 9 * * *", handlerImpl);
