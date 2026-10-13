/**
 * 使わない機能(画面)を、アカウントごとに隠す(2026-10-13、本人「不要な機能は非表示にしたい」「アカウントごとで非表示にできるように」)。
 *
 * 隠すのは「見える所」だけ — メニュー(PC のサイドバー・スマホの下のナビ・「すべて」)、ホームのカード、「＋」の選択肢、
 * 検索パレットの候補。**データは消さない・同期も止めない**。設定でいつでも戻せる。ホームと設定は隠せない(戻る道を残すため)。
 * URL を直接開く・通知から開く(/gmail など)は、隠していても開く。
 *
 * 覚える場所はアカウントごとの端末の中(src/lib/accounts.ts の scopedKey)。別の端末にも同じにするのは hiddenFeaturesSync.ts。
 */
import { scopedKey } from "./accounts";

export type HideableFeature = "schedule" | "money" | "notes" | "gmail" | "trips" | "review";

export interface HideableFeatureInfo {
  key: HideableFeature;
  label: string;
  /** 設定で、何が隠れるかの一言。 */
  note: string;
  /** この機能の画面の道のり(前方一致)。 */
  prefixes: string[];
}

export const HIDEABLE_FEATURES: HideableFeatureInfo[] = [
  { key: "schedule", label: "予定・タスク", note: "カレンダー・予定・タスク", prefixes: ["/schedule", "/calendar"] },
  { key: "money", label: "お金管理", note: "支出・給与・サブスク・固定費", prefixes: ["/records/expense"] },
  { key: "notes", label: "メモ・リスト", note: "メモ・チェックリスト", prefixes: ["/records/notes"] },
  { key: "gmail", label: "Gmail", note: "受信メール・返信の下書き", prefixes: ["/gmail"] },
  { key: "trips", label: "旅行計画", note: "旅行・日程・費用・持ち物・ルート", prefixes: ["/trips"] },
  { key: "review", label: "ふりかえり", note: "お金・予定の集計", prefixes: ["/review"] },
];

const VALID = new Set<string>(HIDEABLE_FEATURES.map((feature) => feature.key));
const STORAGE_KEY = "lifeHubHiddenFeatures:v1";

function storageKey(): string {
  return scopedKey(STORAGE_KEY);
}

/** 知らない名前・重なりを除き、決まった順に並べる(同じ集合なら同じ並びになる)。 */
export function normalizeHiddenFeatures(value: unknown): HideableFeature[] {
  if (!Array.isArray(value)) return [];
  const set = new Set<string>(value.filter((entry): entry is string => typeof entry === "string" && VALID.has(entry)));
  return HIDEABLE_FEATURES.map((feature) => feature.key).filter((key) => set.has(key));
}

export function sameHiddenFeatures(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/** この端末が、隠す設定を一度でも覚えているか(何も隠していない設定を、自分で決めたのか、初期のままかの見分け)。 */
export function hasStoredHiddenFeatures(storage: Pick<Storage, "getItem"> = window.localStorage): boolean {
  try {
    return storage.getItem(storageKey()) !== null;
  } catch {
    return false;
  }
}

export function loadHiddenFeatures(storage: Pick<Storage, "getItem"> = window.localStorage): HideableFeature[] {
  try {
    const stored = storage.getItem(storageKey());
    return stored === null ? [] : normalizeHiddenFeatures(JSON.parse(stored));
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
let snapshot: { raw: string | null; value: readonly HideableFeature[] } | null = null;

/** 画面用。覚えている内容が変わっていない間は同じ配列を返す(useSyncExternalStore は、毎回違う値だと描き直しを繰り返す)。 */
export function getHiddenFeaturesSnapshot(): readonly HideableFeature[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey());
  } catch {
    raw = null;
  }
  if (!snapshot || snapshot.raw !== raw) snapshot = { raw, value: loadHiddenFeatures() };
  return snapshot.value;
}

export function subscribeHiddenFeatures(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 覚える(端末の中)。画面にも知らせる。 */
export function saveHiddenFeatures(hidden: readonly HideableFeature[], storage: Pick<Storage, "setItem"> = window.localStorage): HideableFeature[] {
  const normalized = normalizeHiddenFeatures(hidden);
  try {
    storage.setItem(storageKey(), JSON.stringify(normalized));
  } catch {
    // 覚えられない環境でも、この画面の間は動く(次に開いた時は元に戻る)。
  }
  for (const listener of listeners) listener();
  return normalized;
}

/** 1つだけ隠す／出す。 */
export function setFeatureHidden(key: HideableFeature, hidden: boolean): HideableFeature[] {
  const current = new Set<HideableFeature>(loadHiddenFeatures());
  if (hidden) current.add(key);
  else current.delete(key);
  return saveHiddenFeatures([...current]);
}

/** この道のり(/schedule?view=calendar のような文字でも)は、どの機能の画面か。どれでもなければ null。 */
export function featureForPath(path: string): HideableFeature | null {
  const pathname = path.split(/[?#]/)[0];
  for (const feature of HIDEABLE_FEATURES) {
    if (feature.prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return feature.key;
  }
  return null;
}

/** この道のりの画面は、隠してあるか。 */
export function isPathHidden(path: string, hidden: readonly HideableFeature[]): boolean {
  const feature = featureForPath(path);
  return feature !== null && hidden.includes(feature);
}
