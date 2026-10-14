/**
 * 旅行の画面のタブ(日程・ルート・費用・持ち物・日記・書類)と、その並び。
 *
 * 並びは 2026-10-14 に、ルートを日程のすぐ隣へ(要望「ルートは日程の横がいい」→「日程や費用、ルート、日記とかのタブだよ」)。
 * 日程で決めた予定を、そのままルートで見る・直す、という行き来がいちばん多いため。
 */
export type TripTab = "schedule" | "route" | "expense" | "packing" | "diary" | "documents";

export const TRIP_TAB_OPTIONS: { value: TripTab; label: string }[] = [
  { value: "schedule", label: "日程" },
  { value: "route", label: "ルート" },
  { value: "expense", label: "費用" },
  { value: "packing", label: "持ち物" },
  { value: "diary", label: "日記" },
  { value: "documents", label: "書類" },
];

export const VALID_TRIP_TABS: TripTab[] = TRIP_TAB_OPTIONS.map((option) => option.value);
