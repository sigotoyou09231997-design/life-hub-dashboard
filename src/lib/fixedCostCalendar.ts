import { getDaysInMonth, parseISO } from "date-fns";
import type { FixedCost } from "../types";
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
 * 範囲は月表示の枠(前後の月にはみ出す週を含む)なので、またぐ月ぶんを全部見る。
 */
export function collectFixedCostChipsInRange(
  fixedCosts: FixedCost[],
  rangeStart: string,
  rangeEnd: string,
): Map<string, DayChip[]> {
  const out = new Map<string, DayChip[]>();
  const active = fixedCosts.filter((cost) => cost.active && Number.isFinite(cost.dueDay));
  if (active.length === 0) return out;

  for (const monthStart of monthStartsInRange(rangeStart, rangeEnd)) {
    for (const cost of active) {
      const date = dueDateInMonth(cost.dueDay, monthStart);
      if (date < rangeStart || date > rangeEnd) continue;
      const chips = out.get(date) ?? [];
      chips.push({
        key: `fixed-${cost.id ?? cost.title}-${date}`,
        label: `${cost.title} ${yen(cost.amount)}`,
        color: FIXED_COST_CHIP_COLOR,
        kind: "fixedCost",
      });
      out.set(date, chips);
    }
  }
  return out;
}

/** 範囲にかかっている月の1日を、古い順に。月表示の枠は最大3か月にまたがる。 */
function monthStartsInRange(rangeStart: string, rangeEnd: string): string[] {
  const months: string[] = [];
  let year = Number(rangeStart.slice(0, 4));
  let month = Number(rangeStart.slice(5, 7));
  const endKey = rangeEnd.slice(0, 7);
  for (let guard = 0; guard < 12; guard++) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push(`${key}-01`);
    if (key >= endKey) break;
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return months;
}
