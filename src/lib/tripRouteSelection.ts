/**
 * ルートの「地図に出す場所」の選び方(2026-10-14、要望の受信箱「ルートのマップは、候補がいくつかあるなら選択させ、
 * 選択されたものだけ表示されるようにして欲しい」)。
 *
 * ルートに入れた場所のうち、見たいものだけを地図(鎖)・時間の並び・「全地点をGoogleマップで開く」に出す。
 * 外した場所は**消えない**(ルートには残る)。選びは旅行ごとに、この端末の中だけに覚える(同期はしない — 見方の好みで、
 * 一緒に編集している人の画面まで変えないため)。
 */
import { scopedKey } from "./accounts";

const KEY_PREFIX = "lifeHubRouteHidden:";

function key(tripId: string): string {
  return scopedKey(`${KEY_PREFIX}${tripId}`);
}

/** 外してある場所の id。壊れた記録・文字でないものは無かったことにする。 */
export function readHiddenPlaceIds(tripId: string, storage: Pick<Storage, "getItem"> = window.localStorage): string[] {
  try {
    const raw = JSON.parse(storage.getItem(key(tripId)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** 覚える。もうルートに無い場所の id は、ここで落とす(記録が増え続けないように)。 */
export function writeHiddenPlaceIds(
  tripId: string,
  hiddenIds: readonly string[],
  existingIds: readonly string[],
  storage: Pick<Storage, "setItem" | "removeItem"> = window.localStorage,
): string[] {
  const existing = new Set(existingIds);
  const next = [...new Set(hiddenIds)].filter((id) => existing.has(id));
  try {
    if (next.length === 0) storage.removeItem(key(tripId));
    else storage.setItem(key(tripId), JSON.stringify(next));
  } catch {
    // 覚えられない環境でも、この画面の間は選べる。
  }
  return next;
}

/** 1つの場所を、出す／外す。 */
export function toggleHiddenPlace(hiddenIds: readonly string[], placeId: string, show: boolean): string[] {
  const rest = hiddenIds.filter((id) => id !== placeId);
  return show ? rest : [...rest, placeId];
}
