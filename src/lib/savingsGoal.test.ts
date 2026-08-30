import { describe, expect, it } from "vitest";
import type { SavingsGoal } from "../types";
import {
  calculateSavingsGoalProgress,
  legacySavingsGoalFrom,
  LEGACY_SAVINGS_GOAL_NAME,
  planSavingsGoals,
  sortSavingsGoals,
} from "./savingsGoal";

function goal(name: string, monthlyAmount: number, createdAt: number): SavingsGoal {
  return { id: name, name, monthlyAmount, createdAt };
}

describe("calculateSavingsGoalProgress", () => {
  it("returns null when no goal is set", () => {
    expect(calculateSavingsGoalProgress(0, 50000)).toBeNull();
    expect(calculateSavingsGoalProgress(-1000, 50000)).toBeNull();
  });

  it("reports the shortfall while the remaining balance is under the goal", () => {
    const progress = calculateSavingsGoalProgress(50000, 20000)!;
    expect(progress.ratio).toBe(40);
    expect(progress.shortfall).toBe(30000);
    expect(progress.surplus).toBe(0);
    expect(progress.onTrack).toBe(false);
  });

  it("reports the surplus once the goal is covered", () => {
    const progress = calculateSavingsGoalProgress(50000, 80000)!;
    expect(progress.ratio).toBe(100);
    expect(progress.shortfall).toBe(0);
    expect(progress.surplus).toBe(30000);
    expect(progress.onTrack).toBe(true);
  });

  it("counts exactly reaching the goal as on track", () => {
    const progress = calculateSavingsGoalProgress(50000, 50000)!;
    expect(progress.onTrack).toBe(true);
    expect(progress.ratio).toBe(100);
  });

  it("clamps the ratio at 0 when the remaining balance has gone negative", () => {
    const progress = calculateSavingsGoalProgress(50000, -12000)!;
    expect(progress.ratio).toBe(0);
    expect(progress.shortfall).toBe(62000);
    expect(progress.onTrack).toBe(false);
  });
});

describe("legacySavingsGoalFrom", () => {
  it("1つだけだった頃の目標額を、1件目の目標として引き継ぐ", () => {
    expect(legacySavingsGoalFrom([{ savingsGoalMonthly: 40000 }], 1000)).toEqual({
      name: LEGACY_SAVINGS_GOAL_NAME,
      monthlyAmount: 40000,
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it("未設定(0・欠落・不正な値)なら、空の目標を作らない", () => {
    expect(legacySavingsGoalFrom([{ savingsGoalMonthly: 0 }], 1000)).toBeNull();
    expect(legacySavingsGoalFrom([{}], 1000)).toBeNull();
    expect(legacySavingsGoalFrom([], 1000)).toBeNull();
    expect(legacySavingsGoalFrom([{ savingsGoalMonthly: Number.NaN }], 1000)).toBeNull();
  });

  it("設定の行が複数あっても、目標額が入っている行を拾う", () => {
    expect(legacySavingsGoalFrom([{}, { savingsGoalMonthly: 25000 }], 1)?.monthlyAmount).toBe(25000);
  });
});

describe("sortSavingsGoals", () => {
  it("追加した順(古いものが上)に並べる", () => {
    const goals = [goal("あとから", 1000, 200), goal("さいしょ", 1000, 100)];
    expect(sortSavingsGoals(goals).map((g) => g.name)).toEqual(["さいしょ", "あとから"]);
  });

  it("作成日時が同じでも並びが揺れない", () => {
    const goals = [goal("b", 1000, 100), goal("a", 1000, 100)];
    expect(sortSavingsGoals(goals).map((g) => g.name)).toEqual(["a", "b"]);
    // 元の配列は変えない(useLiveQueryの結果をそのまま渡すため)。
    expect(goals.map((g) => g.name)).toEqual(["b", "a"]);
  });
});

describe("planSavingsGoals", () => {
  const travel = goal("旅行用", 30000, 100);
  const emergency = goal("生活防衛費用", 50000, 200);

  it("目標が無い・全部0なら null(貯金を強制しない)", () => {
    expect(planSavingsGoals([], 80000)).toBeNull();
    expect(planSavingsGoals([goal("未設定", 0, 100)], 80000)).toBeNull();
  });

  it("0以下の目標は数にも合計にも入れない", () => {
    const plan = planSavingsGoals([travel, goal("未設定", 0, 150)], 30000)!;
    expect(plan.allocations).toHaveLength(1);
    expect(plan.totalTarget).toBe(30000);
  });

  it("残額を上の目標から順に埋める", () => {
    const plan = planSavingsGoals([travel, emergency], 45000)!;
    expect(plan.totalTarget).toBe(80000);
    expect(plan.allocations[0].allocated).toBe(30000);
    expect(plan.allocations[0].covered).toBe(true);
    expect(plan.allocations[0].shortfall).toBe(0);
    // 1件目で使い切った残りだけが2件目に回る。
    expect(plan.allocations[1].allocated).toBe(15000);
    expect(plan.allocations[1].covered).toBe(false);
    expect(plan.allocations[1].shortfall).toBe(35000);
    expect(plan.allocations[1].ratio).toBe(30);
    expect(plan.leftover).toBe(0);
  });

  it("全部埋まったら余りが出る", () => {
    const plan = planSavingsGoals([travel, emergency], 100000)!;
    expect(plan.allocations.every((a) => a.covered)).toBe(true);
    expect(plan.leftover).toBe(20000);
    expect(plan.overall.onTrack).toBe(true);
    expect(plan.overall.surplus).toBe(20000);
  });

  it("残額がマイナスなら、どの目標にも配らない", () => {
    const plan = planSavingsGoals([travel, emergency], -5000)!;
    expect(plan.allocations.map((a) => a.allocated)).toEqual([0, 0]);
    expect(plan.allocations.map((a) => a.ratio)).toEqual([0, 0]);
    expect(plan.projected).toBe(-5000);
    expect(plan.overall.ratio).toBe(0);
  });

  it("並び順どおりに配る(渡した順ではなく作成順)", () => {
    const plan = planSavingsGoals([emergency, travel], 30000)!;
    expect(plan.allocations[0].goal.name).toBe("旅行用");
    expect(plan.allocations[0].allocated).toBe(30000);
    expect(plan.allocations[1].allocated).toBe(0);
  });

  it("合計に対する進み具合は、1つだった頃と同じ出し方になる", () => {
    const plan = planSavingsGoals([travel, emergency], 40000)!;
    expect(plan.overall).toEqual(calculateSavingsGoalProgress(80000, 40000));
  });
});
