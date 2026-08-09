import type { ScheduleCategory } from "../types";

export interface ScheduleCategoryDef {
  value: ScheduleCategory;
  label: string;
  /** Badge tone used in detail/list views only — never used for the
   * calendar's type markers (those are fixed blue=event / orange=task). */
  tone: "accent" | "success" | "danger" | "neutral";
}

export const SCHEDULE_CATEGORIES: ScheduleCategoryDef[] = [
  { value: "work", label: "仕事", tone: "accent" },
  { value: "private", label: "プライベート", tone: "success" },
  { value: "important", label: "重要", tone: "danger" },
  { value: "other", label: "その他", tone: "neutral" },
];

/** Missing/unknown category on existing data always displays as "その他"
 * without ever writing back to the record. */
export function getScheduleCategory(value: ScheduleCategory | undefined): ScheduleCategoryDef {
  return SCHEDULE_CATEGORIES.find((c) => c.value === value) ?? SCHEDULE_CATEGORIES[3];
}
