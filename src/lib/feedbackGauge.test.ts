import { describe, expect, it } from "vitest";
import { computeGauge, gaugeLabel } from "./feedbackGauge";

const started = "2026-10-14T00:00:00Z";
const at = (min: number) => new Date(started).getTime() + min * 60_000;

describe("computeGauge", () => {
  it("目安か、修正中になった時刻が無ければ出さない(null)", () => {
    expect(computeGauge(undefined, 6, at(1))).toBeNull();
    expect(computeGauge(started, undefined, at(1))).toBeNull();
    expect(computeGauge(started, 0, at(1))).toBeNull();
    expect(computeGauge("壊れた日付", 6, at(1))).toBeNull();
  });

  it("経過を目安で割った長さ。途中は「あと約○分」", () => {
    const g = computeGauge(started, 6, at(2.5))!;
    expect(g).toMatchObject({ elapsedMin: 2, estimateMin: 6, over: false, remainingMin: 4 });
    expect(g.ratio).toBeCloseTo(2.5 / 6, 5);
    expect(gaugeLabel(g)).toBe("目安 約6分・経過 2分・あと約4分");
  });

  it("始まった直後は 0。端末の時計が少し遅れて経過がマイナスになっても 0 に揃える", () => {
    expect(computeGauge(started, 6, at(0))).toMatchObject({ elapsedMin: 0, ratio: 0 });
    expect(computeGauge(started, 6, at(-3))).toMatchObject({ elapsedMin: 0, ratio: 0, over: false });
  });

  it("目安ちょうど以降は満タンのまま。「あと少し」と言い続けず、過ぎていると正直に言う", () => {
    const g = computeGauge(started, 6, at(9))!;
    expect(g).toMatchObject({ elapsedMin: 9, ratio: 1, over: true, remainingMin: 0 });
    expect(gaugeLabel(g)).toBe("目安の約6分を過ぎています(経過 9分)。もう少しお待ちください");
    expect(computeGauge(started, 6, at(6))!.over).toBe(true);
  });

  it("残りが1分未満でも「あと約0分」とは言わず、1分と言う", () => {
    expect(computeGauge(started, 6, at(5.8))!.remainingMin).toBe(1);
  });
});
