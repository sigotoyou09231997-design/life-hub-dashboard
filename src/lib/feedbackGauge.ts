/**
 * 修正中の依頼の「かかる時間の目安」と、そのゲージ(2026-10-14、本人「修正にどれくらいかかるか時間も出して、ゲージ表示もあると便利」)。
 * 目安の分は、直し始める時に、これまでの実績(scripts/estimate-fix.mjs)から付ける(supabase/sql/037)。計算だけの部分。
 */

export interface Gauge {
  /** 直し始めてから、いままでの分(切り捨て)。 */
  elapsedMin: number;
  estimateMin: number;
  /** 経過 ÷ 目安(0〜1。目安を過ぎたら 1 のまま)。ゲージの長さ。 */
  ratio: number;
  /** 目安を過ぎている。 */
  over: boolean;
  /** 目安までの残りの分(過ぎたら 0)。 */
  remainingMin: number;
}

/** 目安か、いつから修正中かが無ければ null(ゲージを出さない)。 */
export function computeGauge(workingAt: string | undefined, estimateMinutes: number | undefined, nowMs: number): Gauge | null {
  if (!workingAt || !estimateMinutes || estimateMinutes <= 0) return null;
  const started = new Date(workingAt).getTime();
  if (Number.isNaN(started)) return null;
  const elapsedMs = Math.max(0, nowMs - started);
  const elapsedMin = Math.floor(elapsedMs / 60_000);
  const ratio = Math.min(1, elapsedMs / (estimateMinutes * 60_000));
  const over = elapsedMs >= estimateMinutes * 60_000;
  return { elapsedMin, estimateMin: estimateMinutes, ratio, over, remainingMin: over ? 0 : Math.max(1, Math.ceil((estimateMinutes * 60_000 - elapsedMs) / 60_000)) };
}

/** ゲージの下に出す一言。 */
export function gaugeLabel(gauge: Gauge): string {
  if (gauge.over) return `目安の約${gauge.estimateMin}分を過ぎています(経過 ${gauge.elapsedMin}分)。もう少しお待ちください`;
  return `目安 約${gauge.estimateMin}分・経過 ${gauge.elapsedMin}分・あと約${gauge.remainingMin}分`;
}
