import { schedule, type Handler } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendNotification, setVapidDetails, WebPushError } from "web-push";

/** push_subscriptions.disabled_categoriesに入り得る値のうち、この関数が担当する種類
 * (src/lib/pushNotifications.tsのNOTIFICATION_CATEGORIESと同じ文字列)。 */
const CATEGORY = "budget";

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  disabled_categories: string[] | null;
}

export interface SalaryRow {
  month: string; // YYYY-MM
  payday: number;
  amount: number;
}

// このアプリは個人利用の日本語専用アプリという前提(CLAUDE.md)。日付はすべて端末の
// ローカル時刻のままタイムゾーン情報を持たずに保存されているため、
// checkRemindersAndNotify.tsと同じ割り切りでJST固定として扱う。
const JST_OFFSET_MS = 9 * 60 * 60_000;
const ONE_DAY_MS = 24 * 60 * 60_000;

/** nowMsをJSTの壁時計として見た日付(YYYY-MM-DD)。 */
export function jstTodayStr(nowMs: number): string {
  return new Date(nowMs + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function ymd(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 給料日(1-31)をその月の末日で丸めた日付。29-31日が支払日の月でも破綻しないように
 * するのは、画面側(src/lib/payPeriod.tsのclampToMonth)と同じ考え方。 */
function paydayOfMonth(year: number, month1: number, payday: number): string {
  return ymd(year, month1, Math.min(Math.max(payday, 1), daysInMonth(year, month1)));
}

function shiftMonth(year: number, month1: number, delta: 1 | -1): { year: number; month1: number } {
  const month = month1 + delta;
  if (month > 12) return { year: year + 1, month1: 1 };
  if (month < 1) return { year: year - 1, month1: 12 };
  return { year, month1: month };
}

function diffDays(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((to - from) / ONE_DAY_MS);
}

export interface BudgetPeriod {
  periodStart: string; // YYYY-MM-DD
  periodStartMonth: string; // YYYY-MM
  nextPayday: string; // YYYY-MM-DD
  daysUntilNextPayday: number;
  salaryAmount: number;
  /** その期の給与が実際に入力されているか。未入力なら残額は必ずマイナスになるので、
   * 通知の判定ではこれを見て黙る(shouldNotifyBudgetOver)。 */
  hasSalaryForPeriod: boolean;
}

/**
 * 今日がどの給与期間に入っているかを出す。画面側のresolveCurrentPeriod
 * (src/lib/payPeriod.ts)と同じ決め方 — 直近の給与エントリの給料日を繰り返しの型と
 * みなし、その期の給与が入力されていればその額を使う。給与の履歴が1件も無ければnull。
 * サーバー側はJST固定の文字列計算にしてある(端末のローカル時刻に依存させない)。
 */
export function resolveBudgetPeriod(salaries: SalaryRow[], today: string): BudgetPeriod | null {
  if (salaries.length === 0) return null;

  const todayMonth = today.slice(0, 7);
  const sorted = [...salaries].sort((a, b) => a.month.localeCompare(b.month));
  const pastOrCurrent = sorted.filter((s) => s.month <= todayMonth);
  const reference = pastOrCurrent.length > 0 ? pastOrCurrent[pastOrCurrent.length - 1] : sorted[0];

  const year = Number(today.slice(0, 4));
  const month1 = Number(today.slice(5, 7));
  const thisMonthPayday = paydayOfMonth(year, month1, reference.payday);
  const periodStart =
    thisMonthPayday <= today
      ? thisMonthPayday
      : (() => {
          const prev = shiftMonth(year, month1, -1);
          return paydayOfMonth(prev.year, prev.month1, reference.payday);
        })();

  const periodStartMonth = periodStart.slice(0, 7);
  const next = shiftMonth(Number(periodStart.slice(0, 4)), Number(periodStart.slice(5, 7)), 1);
  const nextPayday = paydayOfMonth(next.year, next.month1, reference.payday);
  const exact = salaries.find((s) => s.month === periodStartMonth);

  return {
    periodStart,
    periodStartMonth,
    nextPayday,
    daysUntilNextPayday: diffDays(today, nextPayday),
    salaryAmount: exact?.amount ?? 0,
    hasSalaryForPeriod: exact != null,
  };
}

/** 画面側のcalculatePayPeriodBudgetと同じ式。
 * 残額 = 給与 + その期に入った賞与 - 固定費 - 記録した支出。
 * 賞与は「収入 / ボーナス」の収支として入る(src/lib/bonus.ts)。 */
export function calculateRemaining(
  salaryAmount: number,
  totalFixedCosts: number,
  actualSpending: number,
  bonusAmount = 0,
): number {
  return salaryAmount + bonusAmount - totalFixedCosts - actualSpending;
}

/**
 * 通知するかどうか。残額がマイナスに落ちたときだけ知らせる。
 * その期の給与が未入力のときは黙る — 給与0円として計算した残額は必ずマイナスになり、
 * 「まだ給与を入れていないだけ」の人に毎日「使いすぎです」と送ってしまうため。
 */
export function shouldNotifyBudgetOver(period: BudgetPeriod, remaining: number): boolean {
  return period.hasSalaryForPeriod && period.salaryAmount > 0 && remaining < 0;
}

/** 通知の文面。checkRemindersAndNotify.tsと同じくpublic/push-sw.jsの
 * 単一のpushハンドラで消費される形(title/body/url)。 */
export function buildBudgetOverPayload(remaining: number, daysUntilNextPayday: number): string {
  const over = Math.abs(Math.round(remaining));
  const days = daysUntilNextPayday > 0 ? `次の給料日まであと${daysUntilNextPayday}日です。` : "今日が次の給料日です。";
  return JSON.stringify({
    title: `今期の予算を ¥${over.toLocaleString()} 超えています`,
    body: days,
    url: "/records/expense",
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
        console.error("[checkBudgetAndNotify] push send failed:", err);
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
  const { data: salaryRows, error: salaryError } = await supabase
    .from("salaries")
    .select("month, payday, amount")
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (salaryError) {
    console.error(`[checkBudgetAndNotify] failed to load salaries for ${userId}:`, salaryError.message);
    return;
  }

  const period = resolveBudgetPeriod((salaryRows ?? []) as SalaryRow[], today);
  if (!period) return;

  const [fixedResult, spendingResult, bonusResult] = await Promise.all([
    supabase.from("fixed_costs").select("amount").eq("user_id", userId).eq("active", true).is("deleted_at", null),
    supabase
      .from("transactions")
      .select("amount")
      .eq("user_id", userId)
      .eq("type", "expense")
      .eq("is_fixed", false)
      .gte("date", period.periodStart)
      .lte("date", today)
      .is("deleted_at", null),
    // その期に入った賞与。画面側(src/lib/bonus.ts)と同じで、収入のうちカテゴリが
    // 「ボーナス」のものだけを使えるお金に足す。
    supabase
      .from("transactions")
      .select("amount")
      .eq("user_id", userId)
      .eq("type", "income")
      .eq("category", "ボーナス")
      .gte("date", period.periodStart)
      .lte("date", today)
      .is("deleted_at", null),
  ]);
  if (fixedResult.error || spendingResult.error || bonusResult.error) {
    console.error(
      `[checkBudgetAndNotify] failed to load amounts for ${userId}:`,
      fixedResult.error?.message ?? spendingResult.error?.message ?? bonusResult.error?.message,
    );
    return;
  }

  const sum = (rows: { amount: number }[] | null) => (rows ?? []).reduce((total, row) => total + Number(row.amount), 0);
  const remaining = calculateRemaining(
    period.salaryAmount,
    sum(fixedResult.data as { amount: number }[] | null),
    sum(spendingResult.data as { amount: number }[] | null),
    sum(bonusResult.data as { amount: number }[] | null),
  );

  if (!shouldNotifyBudgetOver(period, remaining)) return;
  await sendToUser(supabase, subs, buildBudgetOverPayload(remaining, period.daysUntilNextPayday));
}

const handlerImpl: Handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error("[checkBudgetAndNotify] missing required environment variables, skipping run");
    return { statusCode: 500, body: "not configured" };
  }

  setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const today = jstTodayStr(Date.now());

  const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
  if (error) {
    console.error("[checkBudgetAndNotify] failed to load push_subscriptions:", error.message);
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
      console.error(`[checkBudgetAndNotify] failed for ${userId}:`, err);
    }
  }

  return { statusCode: 200, body: "ok" };
};

/**
 * 1日1回(JST 8:00)、今期の残額がマイナスになっていないかを見て、なっていれば
 * Web Pushで知らせる。予定・タスクのように「いつ通知するか」が行ごとに決まっている
 * ものと違い、残額は毎分変わり得るので、送りすぎないよう実行そのものを1日1回にして
 * ある(通知済みの印をどこかに持つ必要が無く、テーブルを増やさずに済む)。
 */
export const handler = schedule("0 23 * * *", handlerImpl);
