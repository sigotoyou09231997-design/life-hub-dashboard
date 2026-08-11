import type { TripScheduleType, TripExpenseCategory, TripPackingCategory } from "../types";

type BadgeTone = "accent" | "success" | "danger" | "neutral" | "warning";

export interface TripCategoryDef<T extends string> {
  value: T;
  label: string;
  tone: BadgeTone;
}

export const TRIP_SCHEDULE_TYPES: TripCategoryDef<TripScheduleType>[] = [
  { value: "sightseeing", label: "観光", tone: "accent" },
  { value: "meal", label: "食事", tone: "warning" },
  { value: "transport", label: "移動", tone: "neutral" },
  { value: "lodging", label: "宿泊", tone: "success" },
  { value: "other", label: "その他", tone: "neutral" },
];

export const TRIP_EXPENSE_CATEGORIES: TripCategoryDef<TripExpenseCategory>[] = [
  { value: "transport", label: "交通", tone: "neutral" },
  { value: "lodging", label: "宿泊", tone: "success" },
  { value: "meal", label: "食事", tone: "warning" },
  { value: "sightseeing", label: "観光", tone: "accent" },
  { value: "shopping", label: "買い物", tone: "danger" },
  { value: "other", label: "その他", tone: "neutral" },
];

export const TRIP_PACKING_CATEGORIES: TripCategoryDef<TripPackingCategory>[] = [
  { value: "essentials", label: "必需品", tone: "danger" },
  { value: "clothing", label: "衣類", tone: "accent" },
  { value: "electronics", label: "電子機器", tone: "warning" },
  { value: "documents", label: "書類", tone: "success" },
  { value: "other", label: "その他", tone: "neutral" },
];

function makeGetter<T extends string>(list: TripCategoryDef<T>[]) {
  return (value: T | undefined): TripCategoryDef<T> => list.find((c) => c.value === value) ?? list[list.length - 1];
}

export const getTripScheduleType = makeGetter(TRIP_SCHEDULE_TYPES);
export const getTripExpenseCategory = makeGetter(TRIP_EXPENSE_CATEGORIES);
export const getTripPackingCategory = makeGetter(TRIP_PACKING_CATEGORIES);
