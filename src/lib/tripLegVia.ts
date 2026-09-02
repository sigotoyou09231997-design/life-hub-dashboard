/**
 * 区間を「駅で降りて、そこから歩く」に分ける判断。
 *
 * 新幹線で着いた駅から宿泊先まで、1本の経路として出していたのが元(2026-09-02の指摘)。
 * 地図の線は駅を通っていても、「どの駅で降りて、そこから何分歩くのか」は文字で
 * どこにも出ていなかった。行き先のいちばん近い駅(src/lib/nearestStation.ts)を
 * 経由地として置き、区間を「出発地 → 駅」と「駅 → 行き先(徒歩)」の2つに分ける。
 *
 * ただし経由させると邪魔になる区間もあるので、ここで弾く。
 */
import type { NearestStation, NearestStationResponse } from "./nearestStation";
import { formatDistance, formatDuration } from "./routeInfo";

/** 駅から行き先までがこれより近ければ、その場所は実質その駅そのもの。
 * 「長谷駅で降りて、長谷駅まで徒歩1分」を2区間に分けても読みにくくなるだけ。 */
export const VIA_MIN_WALK_METERS = 150;

export interface LegEnds {
  /** 地図に渡す文字列(住所、現在地なら「緯度,経度」)。 */
  origin: string;
  /** 画面に出す名前(「現在地」「岡山駅」など)。 */
  originLabel: string;
  destination: string;
  destinationLabel: string;
}

/**
 * その区間で経由地として使える駅を返す。使えない時は undefined を返し、
 * 呼び出し側はこれまでどおり1本の経路のまま出す。
 *
 * 駅名(「長谷駅」)がそのまま出発地・行き先に入っている時は分けない —
 * 「長谷駅 → 長谷駅」という区間になってしまうため。「駅」を落とした部分一致
 * (「長谷」)にしないのは、住所側の地名(「鎌倉市」と「鎌倉駅」)まで拾ってしまうから。
 */
export function findViaStation(result: NearestStationResponse | null | undefined, leg: LegEnds): NearestStation | undefined {
  const station = result?.station;
  const name = station?.name.trim();
  if (!station || !name) return undefined;

  const walkMeters = result?.walk?.distanceMeters;
  if (walkMeters != null && walkMeters < VIA_MIN_WALK_METERS) return undefined;

  const ends = [leg.origin, leg.originLabel, leg.destination, leg.destinationLabel];
  if (ends.some((value) => value.includes(name))) return undefined;

  return station;
}

/** 「徒歩7分(600m)」。時間も距離も分からなければ空にする(行そのものを出さない)。 */
export function describeWalk(walk: { durationSeconds?: number; distanceMeters?: number } | undefined): string {
  const time = walk?.durationSeconds != null ? `徒歩${formatDuration(walk.durationSeconds)}` : "";
  const distance = walk?.distanceMeters != null ? formatDistance(walk.distanceMeters) : "";
  if (!time) return distance ? `徒歩${distance}` : "";
  return distance ? `${time}(${distance})` : time;
}
