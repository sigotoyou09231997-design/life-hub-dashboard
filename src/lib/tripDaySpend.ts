import type { TripExpense, TripScheduleItem } from "../types";

/**
 * 費用が「旅行の何日目のものか」。PCの日程タブの右の欄(TripDayPanel)で、見ている日の費用を出すのに使う。
 *
 * 予定に付いた費用(scheduleId)は、その予定の日を正とする。予定の入力で金額を入れると支払日にも同じ日が入るが、
 * あとから予定の日付を直しても支払日は追いかけない(TripScheduleForm)ので、支払日だけを見ると前の日に残る。
 * 予定に付いていない費用は支払日。どちらも無い費用は、どの日にも入れない(旅行全体の合計にだけ入る)。
 */
export function expenseDay(expense: TripExpense, scheduleDates: Map<string, string>): string | undefined {
  const linked = expense.scheduleId ? scheduleDates.get(expense.scheduleId) : undefined;
  return linked ?? expense.paidDate ?? undefined;
}

/** その日の費用。並びは入れた順(費用タブと同じ)。 */
export function expensesOnDay(expenses: TripExpense[], schedule: TripScheduleItem[], date: string): TripExpense[] {
  const scheduleDates = new Map<string, string>();
  for (const item of schedule) if (item.id) scheduleDates.set(item.id, item.date);
  return expenses.filter((expense) => expenseDay(expense, scheduleDates) === date);
}
