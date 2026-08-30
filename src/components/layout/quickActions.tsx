import type { ElementType } from "react";
import { CalendarDays, Mail, Plane, StickyNote, Wallet } from "lucide-react";

export type QuickActionKey = "schedule" | "money" | "notes" | "gmail" | "trips";
/** Storage values from before 予定/タスク were merged into one "schedule" button
 * (both always led to the same /schedule page — see quickActions.tsx's QUICK_ACTIONS
 * for the current single entry). Mapped forward in normalizeQuickActionKeys so an
 * existing saved selection doesn't just silently lose its schedule shortcut. */
type LegacyQuickActionKey = "schedule-calendar" | "schedule-tasks";

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
export const DEFAULT_QUICK_ACTION_KEYS: QuickActionKey[] = ["schedule", "money", "notes", "gmail"];

const LEGACY_QUICK_ACTION_MIGRATIONS: Record<LegacyQuickActionKey, QuickActionKey> = {
  "schedule-calendar": "schedule",
  "schedule-tasks": "schedule",
};

// Color utilities stay literal so Tailwind includes every customizable state in
// the production CSS, including 旅行 even when it is not part of the default four.
export const QUICK_ACTIONS: QuickActionDefinition[] = [
  { key: "schedule", label: "予定", icon: CalendarDays, tintIcon: true, to: "/schedule", color: "text-blue-500", underline: "bg-blue-500" },
  // 色は参考デザインの指定どおり（予定=青・お金管理=紫・メモ=オレンジ・Gmail=赤・旅行=ティール）。
  { key: "money", label: "お金管理", icon: Wallet, tintIcon: true, to: "/records/expense", color: "text-violet-500", underline: "bg-violet-500" },
  { key: "notes", label: "メモ", icon: StickyNote, tintIcon: true, to: "/records/notes", color: "text-orange-500", underline: "bg-orange-500" },
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
    if (typeof entry !== "string") continue;
    const key = (LEGACY_QUICK_ACTION_MIGRATIONS as Record<string, QuickActionKey | undefined>)[entry] ?? (entry as QuickActionKey);
    if (!validKeys.has(key)) continue;
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
