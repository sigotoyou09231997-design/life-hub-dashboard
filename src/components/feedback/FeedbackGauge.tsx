import { computeGauge, gaugeLabel } from "../../lib/feedbackGauge";
import { useNow } from "../../hooks/useNow";
import type { FeedbackItem } from "../../lib/appFeedback";

/**
 * 修正中の依頼の、かかる時間の目安と経過のゲージ。目安が付いていない依頼(035 のころのもの・目安なしの修正中)には、何も出さない。
 * 目安を過ぎたらゲージは満タンのまま、色を変えて「過ぎています」と言う(嘘の「あと少し」を出し続けない)。
 */
export function FeedbackGauge({ item }: { item: Pick<FeedbackItem, "status" | "workingAt" | "estimateMinutes"> }) {
  const now = useNow();
  if (item.status !== "working") return null;
  const gauge = computeGauge(item.workingAt, item.estimateMinutes, now);
  if (!gauge) return null;
  const label = gaugeLabel(gauge);
  return (
    <div className="mt-1.5" data-testid="feedback-gauge">
      <div
        role="progressbar"
        aria-label="修正の進み具合(目安)"
        aria-valuemin={0}
        aria-valuemax={gauge.estimateMin}
        aria-valuenow={Math.min(gauge.elapsedMin, gauge.estimateMin)}
        aria-valuetext={label}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200/70"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${gauge.over ? "bg-amber-500" : "bg-accent"}`}
          style={{ width: `${Math.round(gauge.ratio * 100)}%` }}
        />
      </div>
      <p className={`mt-1 text-xs ${gauge.over ? "text-amber-800" : "text-slate-600"}`}>{label}</p>
    </div>
  );
}
