/**
 * 旅行を、ほかのアカウントと一緒に編集する(supabase/sql/034_trip_members.sql)ための、同期まわりの部品。
 *
 * 他人から共有された旅行も、自分の旅行と同じ Dexie の表に入る(行の user_id が持ち主のまま)。
 * 同期(src/lib/sync.ts)が知っておく必要があるのは次の3つで、ここにまとめてある:
 *   1. どの旅行が「共有されたもの」で、持ち主は誰か。→ 送る時に、行を持ち主の名前で送る(RLS がそれを要求する)。
 *   2. 初めて見る共有の旅行は、過去ぶんも全部取る(いつもの差分の取り込みは、参加より前の行を取りこぼす)。
 *   3. 共有が終わった(外された・抜けた)旅行は、この端末から片付ける。ただし**自分の旅行は絶対に消さない**。
 *
 * 画面(React)は同期の本体を読み込まなくても「この旅行は共有されたものか」を知りたいので、状態の読み書きと
 * 変更の通知は、ここ(軽いモジュール)に置く。
 */
import { scopedKey } from "./accounts";

/** 旅行に紐づく同期の表。この順に取る(旅行 → 中身)。 */
export const SHARED_TRIP_TABLES = [
  "trips",
  "trip_schedule",
  "trip_expenses",
  "trip_packing_items",
  "trip_route_places",
  "trip_expense_currencies",
] as const;

/** trip_id を持つ子の表(通貨の内訳は expense_id だけ持つので別扱い)。 */
export const TRIP_CHILD_TABLES = ["trip_schedule", "trip_expenses", "trip_packing_items", "trip_route_places"] as const;

const OWNERS_KEY = "lifeHubLastSynced:__shared_trip_owners";
const SEEN_KEY = "lifeHubLastSynced:__shared_trips_seen";
// 名前を lifeHubLastSynced: で始めているのは、持ち主が変わってローカルを空にする時(src/lib/dataOwner.ts)に、
// 同期のカーソルと一緒に消えるようにするため(空にした端末に「取り込み済み」の印だけが残ると、二度と取り込まれない)。

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(scopedKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(scopedKey(key), JSON.stringify(value));
  } catch {
    // 書けなくても、このセッションの間は動く(次に開いた時に取り直す)。
  }
}

/** 共有された旅行 → その持ち主。最後に確かめた時のもの。 */
export function readSharedOwners(): Map<string, string> {
  const raw = readJson<Record<string, unknown>>(OWNERS_KEY, {});
  const out = new Map<string, string>();
  for (const [tripId, owner] of Object.entries(raw)) {
    if (typeof owner === "string" && owner) out.set(tripId, owner);
  }
  return out;
}

let ownersSnapshot: { raw: string | null; value: ReadonlyMap<string, string> } | null = null;

/** 画面用。記録が変わっていない間は同じ Map を返す(React の useSyncExternalStore は、毎回違う値だと再描画を繰り返す)。 */
export function getSharedOwnersSnapshot(): ReadonlyMap<string, string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(scopedKey(OWNERS_KEY));
  } catch {
    raw = null;
  }
  if (!ownersSnapshot || ownersSnapshot.raw !== raw) ownersSnapshot = { raw, value: readSharedOwners() };
  return ownersSnapshot.value;
}

export function writeSharedOwners(owners: ReadonlyMap<string, string>): void {
  writeJson(OWNERS_KEY, Object.fromEntries(owners));
  for (const listener of listeners) listener();
}

/** 過去ぶんまで取り込み済みの、共有の旅行。 */
export function readSeenSharedTrips(): Set<string> {
  const raw = readJson<unknown>(SEEN_KEY, []);
  return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
}

export function writeSeenSharedTrips(seen: ReadonlySet<string>): void {
  writeJson(SEEN_KEY, [...seen]);
}

const listeners = new Set<() => void>();
const memberListeners = new Set<() => void>();

/** 招待・参加の状況が変わったかもしれない時(リアルタイムの通知・自分の操作のあと)に呼ばれる。画面が一覧を取り直す。 */
export function subscribeTripMembersChanged(listener: () => void): () => void {
  memberListeners.add(listener);
  return () => {
    memberListeners.delete(listener);
  };
}

export function notifyTripMembersChanged(): void {
  for (const listener of memberListeners) listener();
}

/** 共有された旅行の一覧が変わった時に呼ばれる(画面の「共有」の印を更新する)。 */
export function subscribeSharedOwners(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 同期が、いま何をすればいいか。
 * - backfill: 共有されているが、まだ過去ぶんを取り込んでいない旅行。
 * - release: 取り込み済みだが、もう共有されていない旅行(外された・抜けた)。
 */
export function planSharedTrips(memberships: ReadonlyMap<string, string>, seen: ReadonlySet<string>): { backfill: string[]; release: string[] } {
  return {
    backfill: [...memberships.keys()].filter((id) => !seen.has(id)),
    release: [...seen].filter((id) => !memberships.has(id)),
  };
}

/**
 * 送る行の user_id。共有された旅行の行は、持ち主の名前で送る(参加者の名前で送ると、RLS が断る)。
 * 共有されていない旅行・どの旅行の行か分からないものは null(= いつもどおり自分の名前)。
 * 旅行の判定は、サーバーで確かめた「共有された旅行」の表だけを見る — 行に入っている user_id を信じない
 * (古い端末のデータなど、持ち主以外の user_id が残っている行を、勝手に別人の名前で送らないため)。
 */
export function ownerIdForPush(
  sharedOwners: ReadonlyMap<string, string>,
  tableName: string,
  row: { id?: unknown; tripId?: unknown },
  tripIdOfExpense?: string,
): string | null {
  if (sharedOwners.size === 0) return null;
  let tripId: string | undefined;
  if (tableName === "trips") tripId = typeof row.id === "string" ? row.id : undefined;
  else if (tableName === "trip_expense_currencies") tripId = tripIdOfExpense;
  else if ((TRIP_CHILD_TABLES as readonly string[]).includes(tableName)) tripId = typeof row.tripId === "string" ? row.tripId : undefined;
  return (tripId && sharedOwners.get(tripId)) || null;
}
