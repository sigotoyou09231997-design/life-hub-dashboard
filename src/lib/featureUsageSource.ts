import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "../db/schema";
import { todayStr } from "./date";
import { auth, isSupabaseConfigured } from "./supabase";
import { getSupabaseDataClient } from "./supabaseData";
import {
  LONG_DAYS,
  RECENT_DAYS,
  USAGE_FEATURES,
  countTimestamps,
  monthKey,
  windowStartIso,
  type UsageCountMap,
  type UsageFeature,
  type UsageSnapshot,
} from "./featureUsage";

/**
 * 機能の使われ方を、どこから数えるか(判定は src/lib/featureUsage.ts)。
 *
 * **ログインしていれば Supabase で数える。** 端末の中のデータだと、いちばん使われている
 * Gmail が正しく数えられないため:
 *   - 受信メール(db.syncedEmails)は、Gmail の受信トレイから外れると端末からも消える
 *     (src/lib/gmailSync.ts の pruneMissingEmails)。既読にした記録ごと消える。
 *   - ブロック(db.blockedSenders)は、別の端末でブロックしたぶんが「取り込んだ時刻」で入る。
 *   - 固定費(db.fixedCosts)は作った日時を持っていない。
 * Supabase 側は消した行も deleted_at を付けて残すので、「作ってから消した」も使った回数に入る。
 * RLS で本人の行しか数えないので、アカウントを切り替えればそのアカウントのぶんになる。
 *
 * ログインしていない時(Supabase を設定していない開発環境など)と、Supabase に1つも
 * 届かなかった時だけ、端末のデータで数える。
 */

const SNAPSHOT_KEY = "lifeHubUsageSnapshot";
const DISMISS_KEY = "lifeHubUsageAlertDismissed";
/** 「これまで」の下限。列が null の行(既読にしていないメールなど)を外すために下限を付ける。 */
const EVER_ISO = "1970-01-01T00:00:00.000Z";
/** 一度に数える機能の数。1機能で3本問い合わせるので、並べすぎない。 */
const FEATURES_PER_BATCH = 4;

async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await auth.getSession();
  return data.session?.user.id ?? null;
}

/** 行の中身は取らず、件数だけを返してもらう(head: true)。 */
async function countSince(supabase: SupabaseClient, feature: UsageFeature, sinceIso: string): Promise<number> {
  const { table, column, eq, or } = feature.server;
  let query = supabase.from(table).select("*", { count: "exact", head: true }).gte(column, sinceIso);
  if (eq) query = query.eq(eq[0], eq[1]);
  if (or) query = query.or(or);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function countServerUsage(
  supabase: SupabaseClient,
  features: UsageFeature[] = USAGE_FEATURES,
  nowMs: number = Date.now(),
): Promise<UsageCountMap> {
  const counts: UsageCountMap = {};
  for (let start = 0; start < features.length; start += FEATURES_PER_BATCH) {
    await Promise.all(
      features.slice(start, start + FEATURES_PER_BATCH).map(async (feature) => {
        try {
          const [last30, last90, ever] = await Promise.all([
            countSince(supabase, feature, windowStartIso(nowMs, RECENT_DAYS)),
            countSince(supabase, feature, windowStartIso(nowMs, LONG_DAYS)),
            countSince(supabase, feature, EVER_ISO),
          ]);
          counts[feature.id] = { last30, last90, ever };
        } catch (error) {
          // 表がまだ無い(本番のSQLを流す前)などで数えられない機能は、その機能だけ外す。
          console.error(`[featureUsage] failed to count ${feature.id}:`, error instanceof Error ? error.message : error);
          counts[feature.id] = null;
        }
      }),
    );
  }
  return counts;
}

type StampLoader = () => Promise<Array<number | null | undefined>>;

/** 端末のデータで数えるときの「使った時刻」。null の機能は端末では数えられない。 */
const LOCAL_STAMPS: Record<string, StampLoader | null> = {
  event: async () => (await db.calendarEvents.toArray()).map((row) => row.createdAt),
  task: async () => (await db.tasks.toArray()).map((row) => row.createdAt),
  expense: async () => (await db.transactions.toArray()).filter((row) => row.type === "expense").map((row) => row.createdAt),
  income: async () => (await db.transactions.toArray()).filter((row) => row.type === "income").map((row) => row.createdAt),
  // 端末の固定費は作った日時を持っていない(Supabase 側の created_at はサーバーが付けている)。
  fixedCost: null,
  paypay: async () => (await db.paypayTransactions.toArray()).map((row) => row.importedAt),
  projectTag: async () => (await db.transactionProjectTags.toArray()).map((row) => row.createdAt),
  categoryBudget: async () => (await db.categoryBudgets.toArray()).map((row) => row.createdAt),
  memo: async () => (await db.notes.toArray()).filter((row) => (row.type ?? "memo") === "memo").map((row) => row.createdAt),
  checklist: async () => (await db.notes.toArray()).filter((row) => row.type === "checklist").map((row) => row.createdAt),
  shopping: async () => (await db.notes.toArray()).filter((row) => row.type === "shopping").map((row) => row.createdAt),
  diary: async () => (await db.diaryEntries.toArray()).map((row) => row.createdAt),
  tripSchedule: async () => (await db.tripSchedule.toArray()).map((row) => row.createdAt),
  tripRoute: async () => (await db.tripRoutePlaces.toArray()).map((row) => row.createdAt),
  tripPacking: async () => (await db.tripPackingItems.toArray()).map((row) => row.createdAt),
  tripExpense: async () => (await db.tripExpenses.toArray()).map((row) => row.createdAt),
  tripCurrency: async () => (await db.tripExpenseCurrencies.toArray()).map((row) => row.createdAt),
  gmailRead: async () => (await db.syncedEmails.toArray()).map((row) => row.readAt),
  gmailBlock: async () => (await db.blockedSenders.toArray()).map((row) => row.createdAt),
  gmailReply: async () => (await db.draftReplies.toArray()).map((row) => row.sentAt),
  gmailImportant: async () => (await db.syncedEmails.toArray()).map((row) => row.importantAt),
};

export async function countLocalUsage(
  features: UsageFeature[] = USAGE_FEATURES,
  nowMs: number = Date.now(),
): Promise<UsageCountMap> {
  const counts: UsageCountMap = {};
  for (const feature of features) {
    const load = LOCAL_STAMPS[feature.id];
    if (!load) {
      counts[feature.id] = null;
      continue;
    }
    try {
      counts[feature.id] = countTimestamps(await load(), nowMs);
    } catch (error) {
      console.error(`[featureUsage] failed to count ${feature.id} locally:`, error);
      counts[feature.id] = null;
    }
  }
  return counts;
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // プライベートブラウズなどで読めない時は、覚えていないものとして扱う。
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 覚えられなくても画面は動く(次に開いた時に数え直す・お知らせがもう一度出るだけ)。
  }
}

function readSnapshot(): UsageSnapshot | null {
  const raw = readStored(SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as UsageSnapshot;
    return parsed && typeof parsed === "object" && parsed.counts ? parsed : null;
  } catch {
    return null;
  }
}

async function countUsage(userId: string | null, nowMs: number): Promise<UsageSnapshot> {
  const base = { scope: userId ?? "local", date: todayStr(), generatedAt: nowMs };
  if (userId) {
    try {
      const supabase = await getSupabaseDataClient();
      const counts = await countServerUsage(supabase, USAGE_FEATURES, nowMs);
      if (Object.values(counts).some(Boolean)) return { ...base, source: "server", counts };
    } catch (error) {
      console.error("[featureUsage] failed to reach Supabase:", error);
    }
  }
  return { ...base, source: "local", counts: await countLocalUsage(USAGE_FEATURES, nowMs) };
}

let inFlight: Promise<UsageSnapshot> | null = null;

/**
 * 集計結果を返す。Supabase で数えた結果は、同じ日・同じアカウントのうちは覚えておいたものを
 * 返す(1回数えると問い合わせが60本ほど飛ぶので、画面を開くたびには数えない)。
 * force で数え直す(ふりかえり画面の「数え直す」)。
 *
 * **端末のデータで数えた結果は覚えない。** 端末の中を数えるだけなので軽いうえ、覚えると
 * 開いた直後の件数がその日のあいだ残り、あとから足した記録が翌日まで数に入らない
 * (2026-09-13、全画面スクショで「まだ数えられる記録がありません」と出て気づいた)。
 * ログインしているのに Supabase へ届かなかった時も同じで、つながったら数え直したい。
 */
export function loadUsageSnapshot({ force = false }: { force?: boolean } = {}): Promise<UsageSnapshot> {
  if (!force && inFlight) return inFlight;
  const run = (async () => {
    const userId = await currentUserId();
    if (!force && userId) {
      const cached = readSnapshot();
      if (cached && cached.source === "server" && cached.scope === userId && cached.date === todayStr()) return cached;
    }
    const fresh = await countUsage(userId, Date.now());
    if (fresh.source === "server") writeStored(SNAPSHOT_KEY, JSON.stringify(fresh));
    return fresh;
  })();
  if (force) return run;
  inFlight = run.finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** お知らせを閉じた月(YYYY-MM)。端末ごとに覚える(閉じたかどうかは見ている端末の話なので)。 */
export function readAlertDismissedMonth(): string | null {
  return readStored(DISMISS_KEY);
}

export function dismissUsageAlertsThisMonth(nowMs: number = Date.now()): void {
  writeStored(DISMISS_KEY, monthKey(nowMs));
}
