import type { TripScheduleType, TripExpenseCategory, TripPackingCategory, TripTransportMode } from "../types";

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

/** 移動手段。並びは、旅行の移動で使う順(電車・新幹線が多い)。 */
export const TRIP_TRANSPORT_MODES: { value: TripTransportMode; label: string }[] = [
  { value: "train", label: "電車" },
  { value: "shinkansen", label: "新幹線" },
  { value: "bus", label: "バス" },
  { value: "car", label: "車" },
  { value: "taxi", label: "タクシー" },
  { value: "walk", label: "徒歩" },
  { value: "plane", label: "飛行機" },
  { value: "ferry", label: "フェリー" },
  { value: "bicycle", label: "自転車" },
];

export function isTripTransportMode(value: unknown): value is TripTransportMode {
  return TRIP_TRANSPORT_MODES.some((mode) => mode.value === value);
}

export function transportModeLabel(mode: TripTransportMode | undefined): string | undefined {
  return TRIP_TRANSPORT_MODES.find((option) => option.value === mode)?.label;
}

