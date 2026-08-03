import { subDays } from "date-fns";
import type { HabitLog } from "../types";
import { parseDate, toDateStr } from "./date";

/**
 * Current streak counts trailing consecutive done-days ending today.
 * If today hasn't been checked yet, the streak still counts through
 * yesterday since today isn't "broken" until the day ends.
 */
export function calculateStreak(logs: HabitLog[], todayStr: string): number {
  const doneDates = new Set(logs.filter((l) => l.done).map((l) => l.date));
  let cursor = doneDates.has(todayStr) ? parseDate(todayStr) : subDays(parseDate(todayStr), 1);
  let streak = 0;

  while (doneDates.has(toDateStr(cursor))) {
    streak++;
    cursor = subDays(cursor, 1);
  }

  return streak;
}
