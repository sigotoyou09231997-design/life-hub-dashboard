/**
 * 指の動き(スワイプ・引っ張って更新)の判定だけを集めたところ。画面に触らない計算だけなので、
 * ここだけを単体テストで確かめる(src/lib/gestures.test.ts)。
 *
 * UI/UX 調査メモ 第4弾 A-3(スワイプ)・A-7(引っ張って更新)。
 * 動かす側は src/hooks/useSwipeAction.ts と src/hooks/usePullToRefresh.ts。
 */

/** 指がこれだけ動くまでは、縦か横か決めない(押しただけ・指のぶれをスクロールや払いにしない)。 */
export const GESTURE_SLOP_PX = 10;

/**
 * 画面の左端からこの幅の中で触り始めた指は、払う動きに使わない。
 * iPhone の Safari は左端から右へ払うと「戻る」になるので、行のスワイプと取り合わないように。
 */
export const EDGE_GUARD_PX = 16;

/** 行の幅のこの割合まで払ったら、離した時に決める(それより手前なら元に戻す)。 */
export const SWIPE_COMMIT_RATIO = 0.38;

/** 速く払った(フリック)と見なす速さ(px/ミリ秒)。0.5 = 1秒に500px。 */
export const SWIPE_FLICK_VELOCITY = 0.5;

/** フリックでも、これより短い動きでは決めない(指のぶれで勝手に消えないように)。 */
export const SWIPE_FLICK_MIN_PX = 40;

/** 操作が割り当たっていない向きへ払った時に、行が動ける最大の幅(「この向きには何も無い」の手応え)。 */
export const SWIPE_DEAD_SIDE_MAX_PX = 24;

/** 測れなかった時(行がまだ描かれていない等)の行の幅。スマホの1行ぶんくらい。 */
const FALLBACK_ROW_WIDTH = 320;

export type SwipeIntent = "pending" | "horizontal" | "vertical";
export type SwipeSide = "left" | "right";

/**
 * 指の動きが横(払う)か縦(スクロール)か。どちらかが GESTURE_SLOP_PX を越えた時点で決める。
 * 横は「横の動きが縦より大きい」時だけ — 斜めに動いた指は、スクロールとして画面に任せる。
 */
export function decideSwipeIntent(dx: number, dy: number, slop = GESTURE_SLOP_PX): SwipeIntent {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop) return "pending";
  return ax > ay ? "horizontal" : "vertical";
}

/** 画面の左端すれすれから触り始めたか(iPhone の「戻る」の払いに譲る)。 */
export function startsAtScreenEdge(clientX: number, edge = EDGE_GUARD_PX): boolean {
  return clientX < edge;
}

/**
 * 指の横の動き(dx)から、行をどれだけ動かすか。
 * 操作がある向きは指にそのまま付いていく。無い向きは少しだけ動いて止まる(引っかかる感じ)。
 */
export function swipeOffset(dx: number, sides: { left: boolean; right: boolean }): number {
  const allowed = dx > 0 ? sides.right : dx < 0 ? sides.left : true;
  if (allowed) return dx;
  return Math.sign(dx) * Math.min(SWIPE_DEAD_SIDE_MAX_PX, Math.abs(dx) * 0.2);
}

/** 行の幅の SWIPE_COMMIT_RATIO を越えたか(越えたら色を濃くして「離せば決まる」と見せる)。 */
export function isPastSwipeThreshold(offset: number, width: number): boolean {
  return Math.abs(offset) >= (width > 0 ? width : FALLBACK_ROW_WIDTH) * SWIPE_COMMIT_RATIO;
}

/**
 * 指を離した時に、どちらの操作を決めるか(決めないなら null)。
 * - 幅の SWIPE_COMMIT_RATIO を越えていれば決める。
 * - 越えていなくても、同じ向きへ速く払っていれば(フリック)決める。
 *   ただし途中で引き戻しながら離した時(速さの向きが逆)は決めない — 「やっぱりやめた」の動きなので。
 * - 操作が割り当たっていない向きは、どれだけ動かしても決めない。
 */
export function swipeOutcome(input: {
  offset: number;
  width: number;
  /** 離す直前の横の速さ(px/ミリ秒、右が正)。 */
  velocity: number;
  left: boolean;
  right: boolean;
}): SwipeSide | null {
  const { offset, width, velocity } = input;
  if (offset === 0) return null;
  const side: SwipeSide = offset > 0 ? "right" : "left";
  if (!input[side]) return null;
  if (isPastSwipeThreshold(offset, width)) return side;
  const flicked =
    Math.abs(offset) >= SWIPE_FLICK_MIN_PX &&
    Math.sign(velocity) === Math.sign(offset) &&
    Math.abs(velocity) >= SWIPE_FLICK_VELOCITY;
  return flicked ? side : null;
}

/** 指の位置の記録(直近の数点)から、離す直前の横の速さ(px/ミリ秒)を出す。 */
export function releaseVelocity(samples: readonly { x: number; t: number }[], windowMs = 100): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  // 直近 windowMs の中でいちばん古い点と比べる(1点前だけだと、指を離す瞬間の小さなぶれで向きが変わる)。
  let first = samples[samples.length - 2];
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    if (last.t - samples[i].t > windowMs) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

// ---------------------------------------------------------------------------
// 月のカレンダーを横へ払って、月を変える(src/hooks/useMonthSwipe.ts)

/**
 * 月のカレンダーは、幅のこの割合まで払ったら、離した時に月を変える。
 * 行の払い(SWIPE_COMMIT_RATIO)より軽くしてある — 消える操作と違い、間違えても反対へ払えばすぐ戻るため。
 */
export const MONTH_SWIPE_COMMIT_RATIO = 0.22;

/**
 * 指を離した時に、何か月動かすか(動かさないなら null)。
 * 右へ払う = 前の月(-1)、左へ払う = 次の月(+1)。紙のカレンダーをめくる向き。
 * - 幅の MONTH_SWIPE_COMMIT_RATIO を越えていれば動かす。ただし離す直前に逆向きへ速く戻していたら
 *   (「やっぱりやめた」の動き)動かさない。
 * - 越えていなくても、同じ向きへ速く払っていれば(フリック)動かす。指のぶれでは動かさない。
 */
export function monthSwipeStep(input: { offset: number; width: number; velocity: number }): -1 | 1 | null {
  const { offset, width, velocity } = input;
  if (offset === 0) return null;
  const step = offset > 0 ? -1 : 1;
  const fast = Math.abs(velocity) >= SWIPE_FLICK_VELOCITY;
  const sameWay = Math.sign(velocity) === Math.sign(offset);
  const w = width > 0 ? width : FALLBACK_ROW_WIDTH;
  if (Math.abs(offset) >= w * MONTH_SWIPE_COMMIT_RATIO) return fast && !sameWay ? null : step;
  return Math.abs(offset) >= SWIPE_FLICK_MIN_PX && fast && sameWay ? step : null;
}

// ---------------------------------------------------------------------------
// 引っ張って更新(A-7)

/** 指の動きに対して、目印が動く割合(引くほど重くなる感じ)。 */
export const PULL_RESISTANCE = 0.5;
/** 目印がこれより下へは行かない。 */
export const PULL_MAX_PX = 104;
/** 目印がここまで下りたら、離した時に同期する(指では PULL_THRESHOLD_PX / PULL_RESISTANCE = 128px)。 */
export const PULL_THRESHOLD_PX = 64;

export type PullIntent = "pending" | "pull" | "ignore";

/** 一番上で下へ引いたか。横の払い(行のスワイプ・絞り込みのチップ)や上へのスクロールは引っ張りにしない。 */
export function decidePullIntent(dx: number, dy: number, slop = GESTURE_SLOP_PX): PullIntent {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return "pending";
  return dy > 0 && dy > Math.abs(dx) ? "pull" : "ignore";
}

/** 指が下へ動いた量(dy)から、目印を下ろす量。 */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(PULL_MAX_PX, dy * PULL_RESISTANCE);
}

// ---------------------------------------------------------------------------
// 同じ指を2つの動きが取り合わないための札

export type GestureKind = "swipe" | "pull";

/** 札が持ち主に返されないまま残った時(画面ごと消えた等)に、捨ててよいとみなすまでの時間。 */
const STALE_GESTURE_MS = 4000;

let activeGesture: { kind: GestureKind; at: number } | null = null;

/**
 * いまの指の動きを、この種類の動きが受け持つと宣言する。ほかの種類が受け持っている間は false。
 * 行のスワイプは pointer、引っ張って更新は touch の出来事で動いていて、どちらも同じ指を見ている。
 * 判定はどちらも「最初に GESTURE_SLOP_PX を越えた時の向き」で決まり、本来は重ならないが、
 * 出来事の届く順のずれで両方が動き出さないよう、札を1枚だけにしておく。
 */
export function claimGesture(kind: GestureKind, now = Date.now()): boolean {
  if (activeGesture && activeGesture.kind !== kind && now - activeGesture.at < STALE_GESTURE_MS) return false;
  activeGesture = { kind, at: now };
  return true;
}

export function releaseGesture(kind: GestureKind): void {
  if (activeGesture?.kind === kind) activeGesture = null;
}
