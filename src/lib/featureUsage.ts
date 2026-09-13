import { format } from "date-fns";

/**
 * 機能ごとの使われ方(ふりかえり画面の「機能の使い方」と、使われなくなった機能のお知らせ)。
 *
 * **記録用の仕組みは新しく足していない。** どの機能も、使えば行が1つ増える
 * (予定を作る・メールを既読にする・送信者をブロックする…)ので、その行の日時を数えれば
 * 「いつ使ったか」が分かる。操作ログのテーブルを新しく作ると、作った日からしか数えられず、
 * 90日との比較が3か月先まで出せないため。
 *
 * ここは数え方と判定だけ(画面・通信から切り離してテストする)。数える元は
 * src/lib/featureUsageSource.ts。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 「最近」の幅。お知らせの判定もこの日数で見る。 */
export const RECENT_DAYS = 30;
/** 比べる相手の幅。最近の30日も含む(2026-09-13 の依頼の「90日利用率」そのまま)。 */
export const LONG_DAYS = 90;
/** 「よく使う機能」に並べる数。 */
export const TOP_LIMIT = 5;

/** 急減とみなす下がり方。90日の割合の半分以下になったら。 */
export const DROP_RATIO = 0.5;
/** 急減を見る足切り。もともとほとんど使っていない機能の増減は、1件で割合が大きく動くので見ない。 */
export const DROP_MIN_SHARE90 = 3;
export const DROP_MIN_COUNT90 = 3;
/** 1つの機能がこれ以上を占めていたら、一言コメントで触れる。 */
const LEADER_SHARE = 50;

export type UsageGroup = "予定" | "お金" | "メモ" | "旅行" | "Gmail";
/** light = 押すだけで済む、input = 書き込む・取り込む手間がある。一言コメントの判定に使う。 */
export type UsageEffort = "light" | "input";

/** Supabase でその機能を数えるときの表と列。 */
export interface UsageServerSource {
  table: string;
  /** 「使った時刻」とみなす列。 */
  column: string;
  eq?: [column: string, value: string | boolean];
  /** PostgREST の or 条件。種類が空の古いメモも「メモ」に入れるために使う。 */
  or?: string;
}

export interface UsageFeature {
  id: string;
  label: string;
  group: UsageGroup;
  effort: UsageEffort;
  server: UsageServerSource;
}

/** 数える機能(2026-09-13 の依頼の集計対象)。並び順は、同数のときの並びと「未使用」の並びに使う。 */
export const USAGE_FEATURES: UsageFeature[] = [
  { id: "event", label: "予定", group: "予定", effort: "input", server: { table: "calendar_events", column: "created_at" } },
  { id: "task", label: "タスク", group: "予定", effort: "input", server: { table: "tasks", column: "created_at" } },
  {
    id: "expense",
    label: "支出の記録",
    group: "お金",
    effort: "input",
    server: { table: "transactions", column: "created_at", eq: ["type", "expense"] },
  },
  {
    id: "income",
    label: "収入の記録",
    group: "お金",
    effort: "input",
    server: { table: "transactions", column: "created_at", eq: ["type", "income"] },
  },
  { id: "fixedCost", label: "固定費", group: "お金", effort: "input", server: { table: "fixed_costs", column: "created_at" } },
  {
    id: "paypay",
    label: "PayPay取り込み",
    group: "お金",
    effort: "input",
    server: { table: "paypay_transactions", column: "created_at" },
  },
  {
    id: "projectTag",
    label: "案件タグ",
    group: "お金",
    effort: "input",
    server: { table: "transaction_project_tags", column: "created_at" },
  },
  {
    id: "categoryBudget",
    label: "カテゴリ予算",
    group: "お金",
    effort: "input",
    server: { table: "category_budgets", column: "created_at" },
  },
  {
    id: "memo",
    label: "メモ",
    group: "メモ",
    effort: "input",
    server: { table: "notes", column: "created_at", or: "type.is.null,type.eq.memo" },
  },
  {
    id: "checklist",
    label: "チェックリスト",
    group: "メモ",
    effort: "input",
    server: { table: "notes", column: "created_at", eq: ["type", "checklist"] },
  },
  {
    id: "shopping",
    label: "買い物リスト",
    group: "メモ",
    effort: "input",
    server: { table: "notes", column: "created_at", eq: ["type", "shopping"] },
  },
  { id: "diary", label: "日記", group: "メモ", effort: "input", server: { table: "diary_entries", column: "created_at" } },
  {
    id: "tripSchedule",
    label: "旅行の日程",
    group: "旅行",
    effort: "input",
    server: { table: "trip_schedule", column: "created_at" },
  },
  {
    id: "tripRoute",
    label: "旅行のルート",
    group: "旅行",
    effort: "input",
    server: { table: "trip_route_places", column: "created_at" },
  },
  {
    id: "tripPacking",
    label: "持ち物",
    group: "旅行",
    effort: "input",
    server: { table: "trip_packing_items", column: "created_at" },
  },
  {
    id: "tripExpense",
    label: "旅行の支出",
    group: "旅行",
    effort: "input",
    server: { table: "trip_expenses", column: "created_at" },
  },
  {
    id: "tripCurrency",
    label: "外貨の支出",
    group: "旅行",
    effort: "input",
    server: { table: "trip_expense_currencies", column: "created_at" },
  },
  // Gmail は受信メールそのものを Supabase に置いていないので、状態だけのテーブルで数える
  // (supabase/sql/011_gmail_message_state.sql)。既読はアプリの中で既読にした時刻だけで、
  // Gmail 本体で読んだぶんは入らない。返信は「送信済み」にした時の updated_at で代用する。
  {
    id: "gmailRead",
    label: "Gmailの既読",
    group: "Gmail",
    effort: "light",
    server: { table: "gmail_message_state", column: "read_at" },
  },
  {
    id: "gmailBlock",
    label: "Gmailのブロック",
    group: "Gmail",
    effort: "light",
    server: { table: "blocked_senders", column: "created_at" },
  },
  {
    id: "gmailReply",
    label: "Gmailの返信",
    group: "Gmail",
    effort: "input",
    server: { table: "gmail_message_state", column: "updated_at", eq: ["sent", true] },
  },
  {
    id: "gmailImportant",
    label: "Gmailの重要マーク",
    group: "Gmail",
    effort: "light",
    server: { table: "gmail_message_state", column: "important_at" },
  },
];

export interface UsageCounts {
  /** 直近30日に使った回数。 */
  last30: number;
  /** 直近90日に使った回数(30日のぶんも含む)。 */
  last90: number;
  /** これまでに使った回数。「一度も使っていない」と「しばらく使っていない」を分けるため。 */
  ever: number;
}

/** 機能ID → 回数。数えられなかった機能(表がまだ無い・端末に日時が無い)は null。 */
export type UsageCountMap = Record<string, UsageCounts | null | undefined>;

export type UsageSource = "server" | "local";

/** 1回ぶんの集計結果。端末に1日1回ぶん覚えておく(src/lib/featureUsageSource.ts)。 */
export interface UsageSnapshot {
  /** 誰のデータを数えたか(Supabase のユーザーID、ログインしていなければ "local")。 */
  scope: string;
  /** 数えた日(YYYY-MM-DD)。日が変わったら数え直す。 */
  date: string;
  source: UsageSource;
  generatedAt: number;
  counts: UsageCountMap;
}

export interface FeatureUsage extends UsageCounts {
  feature: UsageFeature;
  /** 数えられた機能全体に占める割合(0〜100)。 */
  share30: number;
  share90: number;
}

export type UsageAlertKind = "stopped" | "dropped";

/** ホームと通知に出すお知らせ1件。 */
export interface UsageAlert {
  usage: FeatureUsage;
  kind: UsageAlertKind;
  message: string;
  detail: string;
}

export interface UnusedFeature {
  usage: FeatureUsage;
  /** stopped = 30日ゼロになった、dropped = 急に減った、idle = 90日以上使っていない、never = 一度も使っていない。 */
  kind: UsageAlertKind | "idle" | "never";
  note: string;
}

export interface UsageReport {
  /** 数えられた機能。直近30日の多い順。 */
  features: FeatureUsage[];
  unavailable: UsageFeature[];
  total30: number;
  total90: number;
  top: FeatureUsage[];
  unused: UnusedFeature[];
  alerts: UsageAlert[];
  comments: string[];
}

export function windowStartIso(nowMs: number, days: number): string {
  return new Date(nowMs - days * DAY_MS).toISOString();
}

/** 使った時刻(epoch ms)の並びを、30日・90日・これまでの回数にする。時刻の無い行は数えない。 */
export function countTimestamps(stamps: Iterable<number | null | undefined>, nowMs: number): UsageCounts {
  const recentStart = nowMs - RECENT_DAYS * DAY_MS;
  const longStart = nowMs - LONG_DAYS * DAY_MS;
  let last30 = 0;
  let last90 = 0;
  let ever = 0;
  for (const stamp of stamps) {
    if (stamp == null || !Number.isFinite(stamp)) continue;
    ever += 1;
    if (stamp >= longStart) last90 += 1;
    if (stamp >= recentStart) last30 += 1;
  }
  return { last30, last90, ever };
}

export function formatShare(share: number): string {
  return `${share.toFixed(1)}%`;
}

function shareOf(count: number, total: number): number {
  return total > 0 ? (count / total) * 100 : 0;
}

/**
 * 急に使われなくなったか。
 *
 * 割合だけで見ると、Gmail を多く使った月には他のすべての機能の割合が下がり、
 * 回数は変わっていないのに「急減」と出てしまう。そのため**割合が半分以下**に加えて、
 * **1日あたりの回数も半分以下**になったものだけを急減とする。
 * 30日の回数が0のものは「最近使われていない」で別に出すので、ここには入れない。
 */
export function isDropped(usage: FeatureUsage): boolean {
  if (usage.last30 === 0) return false;
  if (usage.last90 < DROP_MIN_COUNT90 || usage.share90 < DROP_MIN_SHARE90) return false;
  const shareFell = usage.share30 <= usage.share90 * DROP_RATIO;
  const paceFell = usage.last30 / RECENT_DAYS <= (usage.last90 / LONG_DAYS) * DROP_RATIO;
  return shareFell && paceFell;
}

function buildComments(top: FeatureUsage[], features: FeatureUsage[], alerts: UsageAlert[], total30: number, total90: number): string[] {
  if (total90 === 0) return ["まだ数えられる記録がありません。使ったぶんから自動で数えます。"];
  if (total30 === 0) return ["直近30日は、数えられる操作がありませんでした。"];

  const comments: string[] = [];
  const leader = top[0];
  if (leader && leader.share30 >= LEADER_SHARE) {
    comments.push(`直近30日に使った回数の${formatShare(leader.share30)}が「${leader.feature.label}」です。`);
  }

  const light30 = features.filter((usage) => usage.feature.effort === "light").reduce((sum, usage) => sum + usage.last30, 0);
  const inputFaded = alerts.some((alert) => alert.usage.feature.effort === "input");
  if (inputFaded && shareOf(light30, total30) >= LEADER_SHARE) {
    comments.push("入力の手間がある機能ほど離れやすく、押すだけで済む機能が残る傾向があります。");
  } else if (alerts.length === 0) {
    comments.push("この1か月で、急に使われなくなった機能はありません。");
  }
  return comments;
}

export function summarizeUsage(counts: UsageCountMap, features: UsageFeature[] = USAGE_FEATURES): UsageReport {
  const order = new Map(features.map((feature, index) => [feature.id, index]));
  const counted: { feature: UsageFeature; counts: UsageCounts }[] = [];
  const unavailable: UsageFeature[] = [];
  for (const feature of features) {
    const value = counts[feature.id];
    if (value) counted.push({ feature, counts: value });
    else unavailable.push(feature);
  }

  const total30 = counted.reduce((sum, item) => sum + item.counts.last30, 0);
  const total90 = counted.reduce((sum, item) => sum + item.counts.last90, 0);
  const usages: FeatureUsage[] = counted.map(({ feature, counts: value }) => ({
    feature,
    ...value,
    share30: shareOf(value.last30, total30),
    share90: shareOf(value.last90, total90),
  }));

  const byDefinition = (a: FeatureUsage, b: FeatureUsage) => order.get(a.feature.id)! - order.get(b.feature.id)!;
  const byUse = (a: FeatureUsage, b: FeatureUsage) => b.last30 - a.last30 || b.last90 - a.last90 || byDefinition(a, b);
  const byShare90 = (a: FeatureUsage, b: FeatureUsage) => b.share90 - a.share90 || byUse(a, b);

  const sorted = [...usages].sort(byUse);
  const top = sorted.filter((usage) => usage.last30 > 0).slice(0, TOP_LIMIT);

  const stopped = usages.filter((usage) => usage.last30 === 0 && usage.last90 > 0).sort(byShare90);
  const dropped = usages.filter(isDropped).sort(byShare90);
  const idle = usages.filter((usage) => usage.last90 === 0 && usage.ever > 0).sort(byDefinition);
  const never = usages.filter((usage) => usage.ever === 0).sort(byDefinition);

  const alerts: UsageAlert[] = [
    ...stopped.map((usage) => ({
      usage,
      kind: "stopped" as const,
      message: `${usage.feature.label}、最近使われていません`,
      detail: `90日では${formatShare(usage.share90)}使われていました`,
    })),
    ...dropped.map((usage) => ({
      usage,
      kind: "dropped" as const,
      message: `${usage.feature.label}の利用が急に減っています`,
      detail: `90日で${formatShare(usage.share90)} → 30日で${formatShare(usage.share30)}`,
    })),
  ];

  const unused: UnusedFeature[] = [
    ...alerts.map((alert) => ({ usage: alert.usage, kind: alert.kind, note: alert.detail })),
    ...idle.map((usage) => ({ usage, kind: "idle" as const, note: "90日以上使われていません" })),
    ...never.map((usage) => ({ usage, kind: "never" as const, note: "まだ使われていません" })),
  ];

  return {
    features: sorted,
    unavailable,
    total30,
    total90,
    top,
    unused,
    alerts,
    comments: buildComments(top, usages, alerts, total30, total90),
  };
}

/** お知らせを閉じた月の印。「今月は表示しない」を押した月と同じなら出さない(月1回程度にするため)。 */
export function monthKey(nowMs: number): string {
  return format(new Date(nowMs), "yyyy-MM");
}

export function isDismissedFor(dismissedMonth: string | null, nowMs: number): boolean {
  return dismissedMonth === monthKey(nowMs);
}
