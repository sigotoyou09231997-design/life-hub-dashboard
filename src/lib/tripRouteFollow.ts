import { db } from "../db/schema";
import type { TripRoutePlace, TripScheduleItem } from "../types";
import { routeKey } from "./mailPlanImport";

/**
 * 日程を直したら、その日程から作られたルートの場所も一緒に直す(2026-10-14、要望の受信箱「日程を修正等したらルートにも反映して欲しい」)。
 *
 * ルートの場所(TripRoutePlace)は、日程の場所を住所に写して作られるだけで、元の日程への印(scheduleId)を持たない。
 * そのため日程の場所・日にち・題名を直しても、ルートには古いまま残り、「日程にある場所がまたルートの候補に出る」ことになっていた。
 * 印を足す(SQL が要る)代わりに、直す前の日程の「場所と日にち」で、同じ場所を探して追いかける。
 *
 * 追いかけるのは、取り違えのおそれが無い時だけ。迷う時は何もしない(別の場所を黙って書き換えるより、古いまま残る方が安全):
 *  - 直す前の場所と日にちが、ルートの場所と**ぴったり同じ**ものだけ。見つからない・日にちが決まっていないルートの場所は触らない。
 *  - 同じ日の別の日程が、まだ同じ場所を使っているなら触らない(その場所はまだ要る)。
 *  - 場所を空にしても、ルートからは消さない(消すのは、本人がルートで消す時だけ)。
 *  - 新しい場所が、すでにルートの別の場所として入っていたら、場所は変えない(同じ場所が2つになるのを避ける)。
 */
export interface RouteFollowPlan {
  id: string;
  /** 直す前のルートの場所の名前(知らせる時に使う)。 */
  placeName: string;
  patch: Partial<Pick<TripRoutePlace, "address" | "name" | "date">>;
  /** 何を直したか(知らせる時の言い方。「場所」「日にち」「名前」)。 */
  changed: string[];
}

/** 日程から作られるルートの場所の名前。移動は場所そのもの、それ以外は題名(src/lib/tripRouteSuggestions.ts と同じ決まり)。 */
function derivedName(item: Pick<TripScheduleItem, "type" | "title" | "location">): string {
  return item.type === "transport" ? (item.location?.trim() ?? "") : item.title.trim();
}

/** @param others 直した日程以外の、この旅行の日程(同じ場所をまだ使っている日程があるかを見る)。 */
export function planRouteFollow(
  before: TripScheduleItem,
  after: TripScheduleItem,
  others: TripScheduleItem[],
  places: TripRoutePlace[],
): RouteFollowPlan | null {
  const oldLocation = before.location?.trim();
  if (!oldLocation) return null;
  const oldKey = routeKey(oldLocation);

  const place = places
    .filter((p) => p.id && routeKey(p.address) === oldKey && p.date === before.date)
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
  if (!place?.id) return null;

  const stillUsed = others.some((item) => item.date === before.date && item.location && routeKey(item.location) === oldKey);
  if (stillUsed) return null;

  const patch: RouteFollowPlan["patch"] = {};
  const changed: string[] = [];

  const newLocation = after.location?.trim();
  const locationMoved = Boolean(newLocation) && routeKey(newLocation!) !== oldKey;
  const taken = locationMoved && places.some((p) => p.id !== place.id && routeKey(p.address) === routeKey(newLocation!));
  const nextAddress = locationMoved && !taken ? newLocation! : place.address;
  if (locationMoved && !taken) {
    patch.address = newLocation!;
    changed.push("場所");
  }

  if (after.date !== before.date) {
    patch.date = after.date;
    changed.push("日にち");
  }

  // 名前は、日程から作られたままの時だけ追いかける(ルートで自分で付け直した名前は、そのままにする)。
  if (place.name.trim() === derivedName(before)) {
    const nextName = derivedName({ ...after, location: nextAddress });
    if (nextName && nextName !== place.name.trim()) {
      patch.name = nextName;
      changed.push("名前");
    }
  }

  return changed.length > 0 ? { id: place.id, placeName: place.name, patch, changed } : null;
}

/** 知らせの文。 */
export function describeRouteFollow(plan: RouteFollowPlan): string {
  return `ルートの「${plan.placeName}」も一緒に直しました(${plan.changed.join("・")})`;
}

/**
 * 日程を保存したあとに呼ぶ。ルートの場所を直したら、その知らせの文を返す(直さなかった時は null)。
 * ルートの更新に失敗しても、日程の保存はもう済んでいるので、投げずに null を返す(日程の保存を失敗に見せない)。
 */
export async function followRouteAfterEdit(before: TripScheduleItem, after: TripScheduleItem): Promise<string | null> {
  try {
    const [places, schedule] = await Promise.all([
      db.tripRoutePlaces.where("tripId").equals(after.tripId).toArray(),
      db.tripSchedule.where("tripId").equals(after.tripId).toArray(),
    ]);
    const plan = planRouteFollow(before, after, schedule.filter((item) => item.id !== before.id), places);
    if (!plan) return null;
    await db.tripRoutePlaces.update(plan.id, plan.patch);
    return describeRouteFollow(plan);
  } catch (error) {
    console.error("[route-follow] failed to follow the schedule edit:", error);
    return null;
  }
}
