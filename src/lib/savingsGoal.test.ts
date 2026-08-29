import { describe, expect, it } from "vitest";
import { calculateSavingsGoalProgress } from "./savingsGoal";

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
