import { getDaysInMonth, parseISO } from "date-fns";
import type { FixedCost, SubscriptionDetail } from "../types";
import { billingDatesInRange, pairSubscriptions } from "./subscriptions";
import type { DayChip } from "./eventPeople";

/** 固定費の帯の色。お金管理のエリア色(src/lib/areaColors.ts の money)と同じ調子で、
 * カレンダーの「誰の予定か」の色(PERSON_COLORS)には無い色にしてある —
 * 予定の帯と見分けが付くようにするため。 */
export const FIXED_COST_CHIP_COLOR = "#9a7bb8";

/** その月の支払日。29〜31日が支払日の月は末日に丸める
 * (checkBudgetAndNotify.ts の paydayOfMonth と同じ考え方)。 */
export function dueDateInMonth(dueDay: number, monthStart: string): string {
  const date = parseISO(monthStart);
  const lastDay = getDaysInMonth(date);
  const day = Math.min(Math.max(Math.trunc(dueDay), 1), lastDay);
  return `${monthStart.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

/**
 * 固定費の支払日を、月表示のマスに出す帯にする。
 *
 * 予定(CalendarEvent)としては保存しない — 依頼のとおり、表示のためだけに毎月の
 * 支払日を計算して出す。止めている固定費(active=false)は出さない。
 *
 * サブスクの付け足し(details、types/index.ts の SubscriptionDetail)があれば、年払いは
 * 請求月にだけ、無料体験中・開始予定のものは請求が始まる日から出す
 * (src/lib/subscriptions.ts の billingDatesInRange)。無料体験が終わる日の帯には
 * そう書き添える — 解約するならその前に、と気づけるように。
 *
 * 範囲は月表示の枠(前後の月にはみ出す週を含む)なので、またぐ月ぶんを全部見る。
 */
export function collectFixedCostChipsInRange(
  fixedCosts: FixedCost[],
  rangeStart: string,
  rangeEnd: string,
  details: SubscriptionDetail[] = [],
): Map<string, DayChip[]> {
  const out = new Map<string, DayChip[]>();
  const items = pairSubscriptions(
    fixedCosts.filter((cost) => cost.active && Number.isFinite(cost.dueDay)),
    details,
  );
  for (const item of items) {
    const { cost, detail } = item;
    for (const date of billingDatesInRange(item, rangeStart, rangeEnd)) {
      const trialEnds = detail?.trialEndDate === date;
      const chips = out.get(date) ?? [];
      chips.push({
        key: `fixed-${cost.id ?? cost.title}-${date}`,
        label: `${cost.title}${trialEnds ? "(無料体験おわり)" : ""} ${yen(cost.amount)}`,
        color: FIXED_COST_CHIP_COLOR,
        kind: "fixedCost",
      });
      out.set(date, chips);
    }
  }
  return out;
}
