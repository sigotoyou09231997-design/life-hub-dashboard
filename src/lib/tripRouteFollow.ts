import { db } from "../db/schema";
import type { TripRoutePlace, TripScheduleItem } from "../types";
import { routeKey } from "./mailPlanImport";
import { mapQueryFor } from "./scheduleDetails";
import { isRouteLinked } from "./routeLink";

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
 *
 * 「場所」は、地図に渡す文字(mapQueryFor)で見る: 日程の詳細に住所が入っていれば住所、無ければ場所
 * (2026-10-14、要望「日程で施設の住所が入れられているのであればルートで反映してほしい」)。
 * 住所を足したり直したりしても、ルートの場所の住所が一緒に変わる。住所を入れる前に作ったルートの場所(場所の名前のまま)も、
 * 直す前の場所で見つけて、住所に直す。
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
  const oldQuery = mapQueryFor(before);
  if (!oldQuery) return null;
  // 直す前のルートの場所は、住所で作られていても、住所を入れる前の場所の名前のままでも、見つける。
  const oldKeys = new Set([routeKey(oldQuery), ...(before.location?.trim() ? [routeKey(before.location)] : [])]);
  const keysOf = (item: TripScheduleItem): string[] =>
    [mapQueryFor(item), item.location?.trim(), item.type === "transport" ? item.endLocation?.trim() : undefined].filter((v): v is string => Boolean(v)).map(routeKey);

  const place = places
    .filter((p) => p.id && oldKeys.has(routeKey(p.address)) && p.date === before.date)
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
  if (!place?.id) return null;

  const stillUsed = others.some((item) => item.date === before.date && keysOf(item).some((key) => oldKeys.has(key)));
  if (stillUsed) return null;

  const patch: RouteFollowPlan["patch"] = {};
  const changed: string[] = [];

  const newQuery = mapQueryFor(after);
  const locationMoved = Boolean(newQuery) && routeKey(newQuery!) !== routeKey(place.address);
  const taken = locationMoved && places.some((p) => p.id !== place.id && routeKey(p.address) === routeKey(newQuery!));
  if (locationMoved && !taken) {
    patch.address = newQuery!;
    changed.push("場所");
  }

  if (after.date !== before.date) {
    patch.date = after.date;
    changed.push("日にち");
  }

  // 名前は、日程から作られたままの時だけ追いかける(ルートで自分で付け直した名前は、そのままにする)。
  if (place.name.trim() === derivedName(before)) {
    // 移動の名前は場所(出発地)そのもの。場所を書き換えた時だけ、新しい場所の名前に追いかける。
    const nextName = derivedName({ ...after, location: patch.address !== undefined ? after.location : before.location });
    if (nextName && nextName !== place.name.trim()) {
      patch.name = nextName;
      changed.push("名前");
    }
  }

  return changed.length > 0 ? { id: place.id, placeName: place.name, patch, changed } : null;
}

/**
 * すでにあるルートの場所のうち、日程に住所が入っているのに、場所の名前のままのもの(2026-10-14、要望「日程で施設の住所が
 * 入れられているのであればルートで反映してほしい」)。住所を入れる前に作ったルートの場所が、これに当たる。
 * 同じ日・同じ場所(ぴったり同じ文字)の日程に、詳細の住所が入っていれば、その住所に直す案を返す。
 * すでにルートに同じ住所の場所がある時は、2つにならないよう出さない。
 */
export interface AddressReflect {
  id: string;
  placeName: string;
  /** 直したあとの住所。 */
  address: string;
}

export function planAddressReflect(schedule: TripScheduleItem[], places: TripRoutePlace[]): AddressReflect[] {
  const taken = new Set(places.map((place) => routeKey(place.address)));
  const result: AddressReflect[] = [];
  for (const place of places) {
    if (!place.id || !place.date) continue;
    const key = routeKey(place.address);
    const item = schedule.find((entry) => {
      if (entry.date !== place.date || !entry.address?.trim() || !entry.location?.trim() || routeKey(entry.location) !== key) return false;
      const query = mapQueryFor(entry);
      return Boolean(query) && routeKey(query!) !== key;
    });
    const query = item ? mapQueryFor(item) : undefined;
    if (!query || taken.has(routeKey(query))) continue;
    taken.add(routeKey(query));
    result.push({ id: place.id, placeName: place.name, address: query });
  }
  return result;
}

/**
 * 日程を直した時の、ルートの場所の直し(全部)。出発地(場所・住所)の分と、移動の目的地の分。
 * 目的地は、場所だけの別の日程として見て、同じ決まりで追いかける(2026-10-14)。
 * 同じルートの場所を2回直す案は、1つにする。
 */
export function planRouteFollowAll(
  before: TripScheduleItem,
  after: TripScheduleItem,
  others: TripScheduleItem[],
  places: TripRoutePlace[],
): RouteFollowPlan[] {
  const plans: RouteFollowPlan[] = [];
  const start = planRouteFollow(before, after, others, places);
  if (start) plans.push(start);
  if (before.type === "transport" && before.endLocation?.trim()) {
    const asPlace = (item: TripScheduleItem): TripScheduleItem => ({
      ...item,
      type: "transport",
      location: item.type === "transport" ? (item.endLocation ?? undefined) : undefined,
      address: undefined,
      endLocation: undefined,
    });
    // 出発地の分を直したあとの状態で、目的地を探す(出発地と目的地が同じ場所でも、2回直さない)。
    const end = planRouteFollow(asPlace(before), asPlace(after), others, places.filter((place) => place.id !== start?.id));
    if (end) plans.push(end);
  }
  return plans;
}

/** 知らせの文。 */
export function describeRouteFollow(plan: RouteFollowPlan): string {
  return `ルートの「${plan.placeName}」も一緒に直しました(${plan.changed.join("・")})`;
}

/** 複数の場所を直した時の知らせ。 */
export function describeRouteFollowAll(plans: RouteFollowPlan[]): string {
  return plans.length === 1 ? describeRouteFollow(plans[0]) : `ルートの${plans.map((plan) => `「${plan.placeName}」`).join("・")}も一緒に直しました`;
}

/**
 * 日程を保存したあとに呼ぶ。ルートの場所を直したら、その知らせの文を返す(直さなかった時は null)。
 * ルートの更新に失敗しても、日程の保存はもう済んでいるので、投げずに null を返す(日程の保存を失敗に見せない)。
 */
export async function followRouteAfterEdit(before: TripScheduleItem, after: TripScheduleItem): Promise<string | null> {
  // 連動を切っている旅行(ルートのタブの「日程と連動する」)では、ルートに触らない。
  if (!isRouteLinked(after.tripId)) return null;
  try {
    const [places, schedule] = await Promise.all([
      db.tripRoutePlaces.where("tripId").equals(after.tripId).toArray(),
      db.tripSchedule.where("tripId").equals(after.tripId).toArray(),
    ]);
    const plans = planRouteFollowAll(before, after, schedule.filter((item) => item.id !== before.id), places);
    if (plans.length === 0) return null;
    for (const plan of plans) await db.tripRoutePlaces.update(plan.id, plan.patch);
    return describeRouteFollowAll(plans);
  } catch (error) {
    console.error("[route-follow] failed to follow the schedule edit:", error);
    return null;
  }
}
