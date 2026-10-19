import type { FixedCost } from "../types";
import { chargeInPeriod, cycleOf, type SubscriptionItem } from "./subscriptions";

/**
 * お金管理の「固定費」タブ(2026-10-20、本人「サブスク以外に定額で支払いを登録できる項目」「サブスクではないから名前を変えたい」
 * 「デザインはサブスクとは変えて」「ちゃんと合計の給与から引かれるように」)。
 *
 * 固定費とサブスクは、どちらも同じ固定費の表(fixedCosts。Supabase と同期)に入っている。種類で分ける:
 * 下の種類の支払い(家賃・光熱費・保険など)は「固定費」タブ、それ以外は「サブスク」タブに並ぶ。
 * 表に印の列を足さない(足すと本番の列の追加が要り、それまで同期が止まる)。種類を変えれば、もう一方のタブへ移る。
 * どちらも給料の期間ごとに「使えるお金」から先に引く(src/hooks/usePayPeriodBudget.ts)。
 */
export const FIXED_EXPENSE_CATEGORIES = [
  "家賃",
  "水道光熱費",
  "通信費",
  "保険",
  "ローン",
  "税金・年金",
  "教育",
  "カード",
  "その他の固定費",
];

/** 固定費のタブに並ぶ支払いか(サブスクではないもの)。 */
export function isFixedExpense(cost: Pick<FixedCost, "category">): boolean {
  return FIXED_EXPENSE_CATEGORIES.includes(cost.category);
}

export function splitFixedExpenses(items: SubscriptionItem[]): { fixed: SubscriptionItem[]; subscriptions: SubscriptionItem[] } {
  const fixed: SubscriptionItem[] = [];
  const subscriptions: SubscriptionItem[] = [];
  for (const item of items) (isFixedExpense(item.cost) ? fixed : subscriptions).push(item);
  return { fixed, subscriptions };
}

/** 給料の期間に払う額を、固定費とサブスクに分けて合計する(src/lib/subscriptions.ts の chargeInPeriod と同じ数え方)。 */
export function periodChargeSplit(
  items: SubscriptionItem[],
  periodStart: string,
  periodEnd: string,
): { fixed: number; subscriptions: number } {
  let fixed = 0;
  let subscriptions = 0;
  for (const item of items) {
    const charge = chargeInPeriod(item, periodStart, periodEnd);
    if (isFixedExpense(item.cost)) fixed += charge;
    else subscriptions += charge;
  }
  return { fixed, subscriptions };
}

/**
 * 固定費の一覧の並び: 毎月のものを支払日の順(1日→31日)、そのあと年に1回のものを支払う月・日の順。
 * サブスクの一覧(次の請求が近い順)と違い、ひと月の中のどこで出ていくかが上から読めるようにする。
 */
export function sortByPayDay(items: SubscriptionItem[]): SubscriptionItem[] {
  const key = (item: SubscriptionItem) =>
    cycleOf(item) === "yearly"
      ? 10_000 + (item.detail?.billingMonth ?? 1) * 100 + item.cost.dueDay
      : item.cost.dueDay;
  return [...items].sort((a, b) => key(a) - key(b) || b.cost.amount - a.cost.amount);
}

export interface SalarySplit {
  salary: number;
  fixed: number;
  subscriptions: number;
  spent: number;
  remaining: number;
  /** 帯の幅(0〜1)。合計が給与を超える時は、合計を1として縮める。 */
  shares: { fixed: number; subscriptions: number; spent: number; remaining: number };
}

/** 給与から、固定費・サブスク・使った額を引いた残り(使えるお金と同じ式)と、帯の幅。 */
export function salarySplit(input: { salary: number; fixed: number; subscriptions: number; spent: number }): SalarySplit {
  const { salary, fixed, subscriptions, spent } = input;
  const remaining = salary - fixed - subscriptions - spent;
  const whole = Math.max(salary, fixed + subscriptions + spent, 1);
  const share = (n: number) => Math.max(0, n) / whole;
  return {
    salary,
    fixed,
    subscriptions,
    spent,
    remaining,
    shares: { fixed: share(fixed), subscriptions: share(subscriptions), spent: share(spent), remaining: share(remaining) },
  };
}
