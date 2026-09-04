import { getDaysInMonth, format, differenceInCalendarDays } from "date-fns";
import type { SalaryEntry } from "../types";

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Clamps a day-of-month (e.g. 31) to the last valid day of the given month,
 * so a payday of "29/30/31" degrades gracefully in shorter months. */
export function clampToMonth(year: number, monthIndex0: number, day: number): Date {
  const daysInThatMonth = getDaysInMonth(new Date(year, monthIndex0, 1));
  const clampedDay = Math.min(Math.max(day, 1), daysInThatMonth);
  return new Date(year, monthIndex0, clampedDay);
}

function shiftMonth(year: number, monthIndex0: number, delta: 1 | -1): { year: number; monthIndex0: number } {
  let month = monthIndex0 + delta;
  let y = year;
  if (month > 11) {
    month = 0;
    y += 1;
  } else if (month < 0) {
    month = 11;
    y -= 1;
  }
  return { year: y, monthIndex0: month };
}

/** The most recent occurrence of `payday` on or before `today` (clamped per month). */
export function currentPeriodStart(payday: number, today: Date): Date {
  const t = stripTime(today);
  const thisMonthPayday = clampToMonth(t.getFullYear(), t.getMonth(), payday);
  if (thisMonthPayday.getTime() <= t.getTime()) {
    return thisMonthPayday;
  }
  const prev = shiftMonth(t.getFullYear(), t.getMonth(), -1);
  return clampToMonth(prev.year, prev.monthIndex0, payday);
}

/** The next occurrence of `payday` strictly after `periodStart`. */
export function nextPeriodStart(payday: number, periodStart: Date): Date {
  const next = shiftMonth(periodStart.getFullYear(), periodStart.getMonth(), 1);
  return clampToMonth(next.year, next.monthIndex0, payday);
}

export interface CurrentPayPeriod {
  payday: number;
  periodStart: Date;
  /** YYYY-MM of periodStart — the key used to look up this period's salary entry. */
  periodStartMonth: string;
  nextPayday: Date;
  daysUntilNextPayday: number;
  salaryAmount: number;
  hasSalaryForPeriod: boolean;
}

/**
 * Determines the pay period `today` falls in, using the payday of the most
 * recent salary entry at or before this month as the recurring pattern, then
 * looks up whether an exact entry exists for that period's month. Returns
 * null only when there is no salary history at all yet.
 */
export function resolveCurrentPeriod(salaries: SalaryEntry[], today: Date = new Date()): CurrentPayPeriod | null {
  if (salaries.length === 0) return null;

  const todayMonth = format(stripTime(today), "yyyy-MM");
  const sorted = [...salaries].sort((a, b) => a.month.localeCompare(b.month));
  const pastOrCurrent = sorted.filter((s) => s.month <= todayMonth);
  const referenceEntry = pastOrCurrent.length > 0 ? pastOrCurrent[pastOrCurrent.length - 1] : sorted[0];

  const payday = referenceEntry.payday;
  const periodStart = currentPeriodStart(payday, today);
  const periodStartMonth = format(periodStart, "yyyy-MM");
  const nextPayday = nextPeriodStart(payday, periodStart);
  const daysUntilNextPayday = differenceInCalendarDays(nextPayday, stripTime(today));

  const exactEntry = salaries.find((s) => s.month === periodStartMonth);

  return {
    payday,
    periodStart,
    periodStartMonth,
    nextPayday,
    daysUntilNextPayday,
    salaryAmount: exactEntry?.amount ?? 0,
    hasSalaryForPeriod: exactEntry != null,
  };
}

export interface PayPeriodProgress {
  /** 期の初日から today までの日数(today を含むので、給料日当日は1)。 */
  elapsedDays: number;
  /** today から次の給料日までの残り日数。 */
  remainingDays: number;
}

/** 期のどこまで来たか。使いすぎの予測(src/lib/categoryBudget.ts の forecastFor)が、
 * 「1日あたりいくら使っているか」を出すのに使う。 */
export function payPeriodProgress(period: CurrentPayPeriod, today: Date = new Date()): PayPeriodProgress {
  return {
    elapsedDays: differenceInCalendarDays(stripTime(today), period.periodStart) + 1,
    remainingDays: Math.max(0, period.daysUntilNextPayday),
  };
}

export interface PayPeriodBudgetInput {
  salaryAmount: number;
  /** その期に入った賞与(src/lib/bonus.ts)。給与と同じく使えるお金に足す。
   * 賞与を登録していなければ0。 */
  bonusAmount?: number;
  totalFixedCosts: number;
  actualSpending: number;
  daysUntilNextPayday: number;
}

export interface PayPeriodBudgetResult {
  remaining: number;
  perDayUsable: number;
}

export function calculatePayPeriodBudget(input: PayPeriodBudgetInput): PayPeriodBudgetResult {
  const remaining =
    input.salaryAmount + (input.bonusAmount ?? 0) - input.totalFixedCosts - input.actualSpending;
  const perDayUsable =
    input.daysUntilNextPayday > 0 ? remaining / input.daysUntilNextPayday : remaining;
  return { remaining, perDayUsable };
}
