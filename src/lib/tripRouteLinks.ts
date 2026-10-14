import { db } from "../db/schema";
import type { TripRoutePlace, TripScheduleItem } from "../types";
import { nextRouteSortOrder, routeKey } from "./mailPlanImport";
import { isRouteLinked } from "./routeLink";
import { endMapQueryFor, mapQueryFor } from "./scheduleDetails";
import { toRouteSuggestions } from "./tripRouteSuggestions";

/**
 * 日程とルートの連動のうち、「ルートを直す → 日程も直す」「日程を消す → ルートの場所も外す」「日程を足す → ルートにも入れる」
 * (2026-10-14、要望「日程とルートが連動してほしい」→「全部やって」)。「日程を直す → ルートも直す」は src/lib/tripRouteFollow.ts。
 *
 * ルートの場所は元の日程への印(scheduleId)を持たないので、同じ日・同じ場所(ぴったり同じ文字)で見つける。
 * 迷う時は何もしない(別の場所・別の予定を書き換えない・消さない)。連動は旅行ごとに切れる(src/lib/routeLink.ts)。
 */

type ScheduleField = "address" | "location" | "endAddress" | "endLocation";

/** その日程のどの項目が、このルートの場所(の住所)に当たるか。当たらなければ null。 */
function fieldFor(item: TripScheduleItem, key: string): ScheduleField | null {
  if (item.address?.trim()) {
    const query = mapQueryFor(item);
    if (query && routeKey(query) === key) return "address";
  }
  if (item.location?.trim() && routeKey(item.location) === key) return "location";
  // 移動の目的地(住所が入っていれば住所、無ければ目的地の名前。住所が入った後も、名前のままのルートの場所を見つける)。
  if (item.type === "transport") {
    if (item.endAddress?.trim()) {
      const query = endMapQueryFor(item);
      if (query && routeKey(query) === key) return "endAddress";
    }
    if (item.endLocation?.trim() && routeKey(item.endLocation) === key) return "endLocation";
  }
  return null;
}

// ── 日程を足したら、ルートにも入れる ────────────────────────────────────────

/**
 * いま足した日程(ids)のうち、まだルートに無い場所を、ルートに入れる行にする。
 * 「日程に入っている場所」の候補(toRouteSuggestions)と同じ決まり(住所があれば住所・移動は出発地と目的地・同じ場所は1回)で、
 * 回る順は末尾に足す。足した日程の分だけ(前から候補に残っている別の場所は、そのまま候補のまま)。
 */
export function planRouteAdds(
  newIds: string[],
  schedule: TripScheduleItem[],
  places: TripRoutePlace[],
  tripId: string,
  now: number,
): TripRoutePlace[] {
  const wanted = new Set(newIds.flatMap((id) => [id, `${id}#end`]));
  const picked = toRouteSuggestions(schedule, places).filter((suggestion) => wanted.has(suggestion.scheduleId));
  let sortOrder = nextRouteSortOrder(places);
  return picked.map((suggestion) => ({
    tripId,
    name: suggestion.name,
    address: suggestion.address,
    sortOrder: sortOrder++,
    date: suggestion.date || undefined,
    memo: suggestion.memo,
    visited: false,
    createdAt: now,
  }));
}

/** 日程を足したあとに呼ぶ。ルートに入れた場所の数を返す(入れなかった・連動を切っている時は 0)。失敗しても投げない。 */
export async function addRouteForNewSchedule(tripId: string, newIds: string[]): Promise<number> {
  if (!isRouteLinked(tripId) || newIds.length === 0) return 0;
  try {
    const [places, schedule] = await Promise.all([
      db.tripRoutePlaces.where("tripId").equals(tripId).toArray(),
      db.tripSchedule.where("tripId").equals(tripId).toArray(),
    ]);
    const rows = planRouteAdds(newIds, schedule, places, tripId, Date.now());
    if (rows.length === 0) return 0;
    await db.tripRoutePlaces.bulkAdd(rows);
    return rows.length;
  } catch (error) {
    console.error("[route-link] failed to add route places for new schedule:", error);
    return 0;
  }
}

// ── 日程を消したら、ルートの場所も外す ──────────────────────────────────────

/** 日程から作られたルートの場所に、そのとき付いたメモ(src/lib/tripRouteSuggestions.ts と同じ決まり)。 */
function derivedMemo(item: TripScheduleItem): string | undefined {
  return item.type === "transport" ? item.title.trim() : item.memo?.trim() || undefined;
}

/** 日程から作られたルートの場所の名前。 */
function derivedName(item: TripScheduleItem, field: ScheduleField): string {
  if (item.type === "transport") return (field === "endLocation" || field === "endAddress" ? item.endLocation : item.location)?.trim() ?? "";
  return item.title.trim();
}

/**
 * 消す日程から作られた、ルートの場所。次のどれかなら、外さずに残す(別の場所・手をかけた場所を消さない):
 *  - 同じ日に、まだその場所を使っている別の日程がある。
 *  - 「行った」にしてある・自分でメモを書き足してある・自分で名前を付け直してある。
 */
export function planRouteRemoval(deleted: TripScheduleItem, remaining: TripScheduleItem[], places: TripRoutePlace[]): TripRoutePlace[] {
  const sameDay = remaining.filter((item) => item.date === deleted.date);
  const removable: TripRoutePlace[] = [];
  for (const place of places) {
    if (!place.id || place.date !== deleted.date) continue;
    const key = routeKey(place.address);
    const field = fieldFor(deleted, key);
    if (!field) continue;
    if (sameDay.some((item) => fieldFor(item, key))) continue;
    if (place.visited) continue;
    if (place.memo?.trim() && place.memo.trim() !== derivedMemo(deleted)) continue;
    if (place.name.trim() !== derivedName(deleted, field)) continue;
    removable.push(place);
  }
  return removable;
}

/** 消す前に、ルートから外す場所を調べる(DB を読むだけ。連動を切っている時・失敗した時は空)。 */
export async function routePlacesToRemove(deleted: TripScheduleItem): Promise<TripRoutePlace[]> {
  if (!isRouteLinked(deleted.tripId)) return [];
  try {
    const [places, schedule] = await Promise.all([
      db.tripRoutePlaces.where("tripId").equals(deleted.tripId).toArray(),
      db.tripSchedule.where("tripId").equals(deleted.tripId).toArray(),
    ]);
    return planRouteRemoval(deleted, schedule.filter((item) => item.id !== deleted.id), places);
  } catch (error) {
    console.error("[route-link] failed to plan route removal:", error);
    return [];
  }
}

// ── ルートを直したら、元の日程も直す ────────────────────────────────────────

export interface ScheduleFollowPlan {
  id: string;
  title: string;
  patch: Partial<Pick<TripScheduleItem, "address" | "location" | "endLocation" | "endAddress" | "date" | "title" | "sortOrder">>;
  /** 何を直したか(「場所」「住所」「目的地」「日にち」「題名」)。 */
  changed: string[];
}

const FIELD_LABEL: Record<ScheduleField, string> = { address: "住所", location: "場所", endAddress: "目的地の住所", endLocation: "目的地" };

/**
 * ルートの場所を直した時に、同じ日・同じ場所の日程を直す案(その場所を使っている日程ぜんぶ)。
 *  - 住所(場所)を変えた → 日程の、その場所が入っている項目(詳細の住所・場所・移動の目的地)を新しい文字に。
 *  - 日にちを変えた → 日程の日にちも(何日かにまたがる日程は触らない。日にちが決まっていない場所には変えない)。
 *    日にちか時刻を直した日程は並びから外す(sortOrder: null。日程フォームと同じ決まり)。
 *  - 名前を変えた → 日程の題名が、直す前のルートの名前のままの時だけ(移動は、名前が場所なので題名は触らない)。
 */
export function planScheduleFollow(before: TripRoutePlace, after: TripRoutePlace, schedule: TripScheduleItem[]): ScheduleFollowPlan[] {
  const key = routeKey(before.address);
  const matches = schedule
    .filter((item) => item.id && (before.date ? item.date === before.date : true))
    .map((item) => ({ item, field: fieldFor(item, key) }))
    .filter((entry): entry is { item: TripScheduleItem; field: ScheduleField } => entry.field !== null);
  if (matches.length === 0) return [];
  // 日にちの無い場所で、複数の日に同じ場所の日程がある時は、どの日か決められない。
  if (!before.date && new Set(matches.map((entry) => entry.item.date)).size > 1) return [];

  const plans: ScheduleFollowPlan[] = [];
  for (const { item, field } of matches) {
    const patch: ScheduleFollowPlan["patch"] = {};
    const changed: string[] = [];

    const newAddress = after.address.trim();
    if (newAddress && routeKey(newAddress) !== key) {
      patch[field] = newAddress;
      changed.push(FIELD_LABEL[field]);
    }

    if (before.date && after.date && after.date !== before.date && !item.endDate) {
      patch.date = after.date;
      patch.sortOrder = null;
      changed.push("日にち");
    }

    if (
      field !== "endLocation" &&
      field !== "endAddress" &&
      item.type !== "transport" &&
      after.name.trim() &&
      after.name.trim() !== before.name.trim() &&
      routeKey(item.title) === routeKey(before.name)
    ) {
      patch.title = after.name.trim();
      changed.push("題名");
    }

    if (changed.length > 0) plans.push({ id: item.id!, title: item.title, patch, changed });
  }
  return plans;
}

/** 知らせの文。 */
export function describeScheduleFollow(plans: ScheduleFollowPlan[]): string {
  const names = plans.map((plan) => `「${plan.title}」`).join("・");
  const changed = [...new Set(plans.flatMap((plan) => plan.changed))].join("・");
  return `日程の${names}も一緒に直しました(${changed})`;
}

/**
 * ルートの場所を保存したあとに呼ぶ。日程を直したら、知らせの文を返す(直さなかった・連動を切っている時は null)。
 * 日程の更新に失敗しても、ルートの保存は済んでいるので、投げずに null を返す。
 */
export async function followScheduleAfterRouteEdit(before: TripRoutePlace, after: TripRoutePlace): Promise<string | null> {
  if (!isRouteLinked(after.tripId)) return null;
  try {
    const schedule = await db.tripSchedule.where("tripId").equals(after.tripId).toArray();
    const plans = planScheduleFollow(before, after, schedule);
    if (plans.length === 0) return null;
    for (const plan of plans) await db.tripSchedule.update(plan.id, plan.patch);
    return describeScheduleFollow(plans);
  } catch (error) {
    console.error("[route-link] failed to follow the route edit:", error);
    return null;
  }
}
