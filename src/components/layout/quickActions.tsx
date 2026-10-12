import type { ElementType } from "react";
import { CalendarDays, Home, Mail, Plane, StickyNote, Wallet } from "lucide-react";

export type QuickActionKey = "home" | "schedule" | "money" | "notes" | "gmail" | "trips";
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
/** 2026-10-12(UI/UX 調査メモ A-2)に「ホーム・予定・お金・メモ」へ。右端には入れ替えられない
 * 「すべて」が必ず付く(QuickActionBar.tsx)ので、Gmail・旅行はそこから、または
 * 「追従ボタンを編集」で入れ替えて出す。前に並びを保存した人は、その並びのまま。 */
export const DEFAULT_QUICK_ACTION_KEYS: QuickActionKey[] = ["home", "schedule", "money", "notes"];

const LEGACY_QUICK_ACTION_MIGRATIONS: Record<LegacyQuickActionKey, QuickActionKey> = {
  "schedule-calendar": "schedule",
  "schedule-tasks": "schedule",
};

// Color utilities stay literal so Tailwind includes every customizable state in
// the production CSS, including 旅行 even when it is not part of the default four.
// 2026-10-12: 機能ごとの色(予定=青・お金=紫…)をやめ、青緑1色にそろえた(UI/UX 調査メモ C-1。
// 操作の部分は青緑、という theme-teal.css の決まり。下のナビは theme-teal.css が
// 選んでいない物を灰色・選んでいる物を青緑に塗るので、ここの色は編集シートで使う)。
export const QUICK_ACTIONS: QuickActionDefinition[] = [
  { key: "home", label: "ホーム", icon: Home, tintIcon: true, to: "/", color: "text-teal-600", underline: "bg-teal-500" },
  { key: "schedule", label: "予定", icon: CalendarDays, tintIcon: true, to: "/schedule", color: "text-teal-600", underline: "bg-teal-500" },
  { key: "money", label: "お金管理", icon: Wallet, tintIcon: true, to: "/records/expense", color: "text-teal-600", underline: "bg-teal-500" },
  { key: "notes", label: "メモ", icon: StickyNote, tintIcon: true, to: "/records/notes", color: "text-teal-600", underline: "bg-teal-500" },
  // Gmailの4色ロゴは、ナビの中でここだけ多色になって浮く。ロゴ本体はGmail画面の
  // ヘッダーに残してあるので、ここは他の項目と同じ単色のアイコンにする。
  { key: "gmail", label: "Gmail", icon: Mail, tintIcon: true, to: "/gmail", color: "text-teal-600", underline: "bg-teal-500" },
  { key: "trips", label: "旅行", icon: Plane, tintIcon: true, to: "/trips", color: "text-teal-600", underline: "bg-teal-500" },
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
