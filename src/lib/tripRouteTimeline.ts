import type { TripRoutePlace, TripScheduleItem } from "../types";
import { routeKey } from "./mailPlanImport";
import { mapQueryFor } from "./scheduleDetails";

/**
 * ルートの「時間で見る」並び(src/components/trips/TripRouteTimeline.tsx)の材料。
 *
 * ルートの場所(tripRoutePlaces)には時刻が無い — 時刻を持っているのは日程(tripSchedule)の方。
 * 同じ出来事を別の表から見ているだけなので、同じ場所で日にちも同じ予定を探して、その時刻を借りる
 * (日程から起こした場所は、住所が日程の「場所」とそのまま一致する。src/lib/tripRouteSuggestions.ts。
 * 手で入れた場所は、名前が日程の見出しや場所と同じなら一致とする)。見つからない場所は「時刻なし」のまま出す。
 */
export interface TimelineStop {
  place: TripRoutePlace;
  /** 日程から借りた時刻(HH:mm)。 */
  startTime?: string;
  /** 終了時刻。移動なら到着時刻。 */
  endTime?: string;
  /** 日程側の見出し(「ランチ」「はやぶさ13号」)。場所の名前と同じなら付けない。 */
  title?: string;
  /** 元になった日程(2026-10-14、要望「ルートの予定を選択して元になった予定を開くことができると効率的」)。見つからなければ無い。 */
  source?: TripScheduleItem;
}

/** "HH:mm" を、0時からの分にする。形が違えば undefined。 */
export function toMinutes(time: string | undefined): number | undefined {
  const match = time?.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

/** 0時からの分を "HH:mm" にする。24時を超えたら「翌」を付ける(夜行・深夜の移動)。 */
export function toClock(totalMinutes: number): string {
  const wrapped = totalMinutes % (24 * 60);
  const text = `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
  return totalMinutes >= 24 * 60 ? `翌${text}` : text;
}

/** その日程が、この場所のことか。住所が同じ(日程から起こした場所はこれ)か、手で入れた場所でも
 * 名前が日程の見出し・場所と同じ時。部分一致は使わない — 「京都駅」と「京都駅前のホテル」のような
 * 別の場所に時刻を付けてしまうより、時刻なしのままの方が間違いに気づける。 */
function isSamePlace(place: TripRoutePlace, item: TripScheduleItem): boolean {
  const address = routeKey(place.address);
  const name = routeKey(place.name);
  // 日程の「場所」のほか、詳細の住所(地図には住所が渡る)と、移動の目的地も、ルートの場所になる(2026-10-14)。
  const spots = [item.location, mapQueryFor(item), item.type === "transport" ? item.endLocation : undefined]
    .filter((spot): spot is string => Boolean(spot?.trim()))
    .map(routeKey);
  if (spots.some((spot) => spot === address || spot === name)) return true;
  return routeKey(item.title) === name || routeKey(item.title) === address;
}

/** ルートの場所の元になった日程。日にちと場所(または名前)が同じ予定。見つからなければ undefined。 */
export function findSourceSchedule(place: TripRoutePlace, schedule: TripScheduleItem[]): TripScheduleItem | undefined {
  return pickScheduleItem(place, schedule);
}

function pickScheduleItem(place: TripRoutePlace, schedule: TripScheduleItem[]): TripScheduleItem | undefined {
  const matches = schedule.filter((item) => isSamePlace(place, item) && (place.date ? item.date === place.date : true));
  if (matches.length === 0) return undefined;
  // 日にちが決まっていない場所で、複数の日に同じ住所の予定がある時は、どの日か決められない。
  if (!place.date && new Set(matches.map((item) => item.date)).size > 1) return undefined;
  // 同じ場所に同じ日に複数あれば、いちばん早い時刻のもの(時刻の無いものは後ろ)。
  return [...matches].sort(
    (a, b) =>
      (toMinutes(a.startTime) ?? Number.POSITIVE_INFINITY) - (toMinutes(b.startTime) ?? Number.POSITIVE_INFINITY) ||
      a.createdAt - b.createdAt,
  )[0];
}

/** 回る順に並んだ場所に、日程の時刻を付ける。順番はそのまま(並べ替えない)。 */
export function buildRouteTimeline(places: TripRoutePlace[], schedule: TripScheduleItem[]): TimelineStop[] {
  return places.map((place) => {
    const item = pickScheduleItem(place, schedule);
    const title = item?.title.trim();
    return {
      place,
      startTime: item?.startTime,
      endTime: item?.endTime,
      title: title && title !== place.name.trim() ? title : undefined,
      source: item,
    };
  });
}

/**
 * 前の場所の終わりから、次の場所の始まりまで、何分あるか。
 * 前の場所に終了時刻がある時だけ出す — 開始時刻しか無いと、どれだけ居るのかが分からず、
 * 「あと何分」が当てずっぽうになるため。
 */
export function gapMinutes(from: TimelineStop, to: TimelineStop): number | undefined {
  const end = toMinutes(from.endTime);
  const start = toMinutes(to.startTime);
  if (end == null || start == null) return undefined;
  return start - end;
}

/**
 * 次の場所に着く目安。前の場所の終了時刻に、移動の所要時間を足す。
 * 終了時刻が分からなければ出さない(同じ理由)。
 */
export function estimateArrival(from: TimelineStop, travelSeconds: number | undefined): string | undefined {
  const end = toMinutes(from.endTime);
  if (end == null || travelSeconds == null) return undefined;
  return toClock(end + Math.ceil(travelSeconds / 60));
}
