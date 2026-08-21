import type { ElementType } from "react";
import { CalendarDays, CheckSquare, Mail, Plane, StickyNote, Wallet } from "lucide-react";

export type QuickActionKey = "schedule-calendar" | "schedule-tasks" | "money" | "notes" | "gmail" | "trips";

export interface QuickActionDefinition {
  key: QuickActionKey;
  label: string;
  icon: ElementType;
  tintIcon: boolean;
  to: string;
  color: string;
  underline: string;
}

export const QUICK_ACTION_LIMIT = 5;
export const QUICK_ACTION_STORAGE_KEY = "lifeHubQuickActions:v1";
export const DEFAULT_QUICK_ACTION_KEYS: QuickActionKey[] = [
  "schedule-calendar",
  "schedule-tasks",
  "money",
  "notes",
  "gmail",
];

// Color utilities stay literal so Tailwind includes every customizable state in
// the production CSS, including 旅行 even when it is not part of the default five.
export const QUICK_ACTIONS: QuickActionDefinition[] = [
  { key: "schedule-calendar", label: "予定", icon: CalendarDays, tintIcon: true, to: "/schedule?view=calendar", color: "text-blue-500", underline: "bg-blue-500" },
  { key: "schedule-tasks", label: "タスク", icon: CheckSquare, tintIcon: true, to: "/schedule?view=list", color: "text-emerald-500", underline: "bg-emerald-500" },
  { key: "money", label: "収支", icon: Wallet, tintIcon: true, to: "/records/expense", color: "text-orange-500", underline: "bg-orange-500" },
  { key: "notes", label: "メモ", icon: StickyNote, tintIcon: true, to: "/records/notes", color: "text-violet-500", underline: "bg-violet-500" },
  // Gmailの4色ロゴは、ナビの中でここだけ多色になって浮く。ロゴ本体はGmail画面の
  // ヘッダーに残してあるので、ここは他の項目と同じ単色のアイコンにする。
  { key: "gmail", label: "Gmail", icon: Mail, tintIcon: true, to: "/gmail", color: "text-rose-500", underline: "bg-rose-500" },
  { key: "trips", label: "旅行", icon: Plane, tintIcon: true, to: "/trips", color: "text-teal-500", underline: "bg-teal-500" },
];

const validKeys = new Set<QuickActionKey>(QUICK_ACTIONS.map(({ key }) => key));

export function normalizeQuickActionKeys(value: unknown): QuickActionKey[] {
  if (!Array.isArray(value)) return [...DEFAULT_QUICK_ACTION_KEYS];
  const normalized: QuickActionKey[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !validKeys.has(entry as QuickActionKey)) continue;
    const key = entry as QuickActionKey;
    if (!normalized.includes(key)) normalized.push(key);
    if (normalized.length === QUICK_ACTION_LIMIT) break;
  }
  return normalized.length > 0 ? normalized : [...DEFAULT_QUICK_ACTION_KEYS];
}

export function loadQuickActionKeys(storage: Pick<Storage, "getItem"> = window.localStorage): QuickActionKey[] {
  try {
    const stored = storage.getItem(QUICK_ACTION_STORAGE_KEY);
    return stored === null ? [...DEFAULT_QUICK_ACTION_KEYS] : normalizeQuickActionKeys(JSON.parse(stored));
  } catch {
    return [...DEFAULT_QUICK_ACTION_KEYS];
  }
}

export function saveQuickActionKeys(
  keys: readonly QuickActionKey[],
  storage: Pick<Storage, "setItem"> = window.localStorage,
): QuickActionKey[] {
  const normalized = normalizeQuickActionKeys(keys);
  try {
    storage.setItem(QUICK_ACTION_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // The live state can still update when storage is unavailable/private.
  }
  return normalized;
}

export function getQuickAction(key: QuickActionKey): QuickActionDefinition {
  return QUICK_ACTIONS.find((action) => action.key === key)!;
}
