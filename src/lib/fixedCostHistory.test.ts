import { describe, expect, it } from "vitest";
import type { FixedCostAmountChange } from "../types";
import { changeDiff, changeDiffLabel, groupChangesByFixedCost, latestChange, sortChanges } from "./fixedCostHistory";

function change(over: Partial<FixedCostAmountChange> & { changedAt: number }): FixedCostAmountChange {
  return {
    id: `c-${over.changedAt}`,
    fixedCostId: "cost-1",
    previousAmount: 980,
    amount: 1_180,
    createdAt: over.changedAt,
    ...over,
  };
}

describe("sortChanges / latestChange", () => {
  it("新しい順に並べる", () => {
    const rows = [change({ changedAt: 100 }), change({ changedAt: 300 }), change({ changedAt: 200 })];
    expect(sortChanges(rows).map((c) => c.changedAt)).toEqual([300, 200, 100]);
    expect(latestChange(rows)?.changedAt).toBe(300);
  });

  it("同じ時刻なら、あとから入れた方を先に見せる", () => {
    const rows = [
      change({ changedAt: 100, createdAt: 1, id: "先" }),
      change({ changedAt: 100, createdAt: 2, id: "後" }),
    ];
    expect(sortChanges(rows).map((c) => c.id)).toEqual(["後", "先"]);
  });

  it("1件も無ければ直近も無い", () => {
    expect(latestChange([])).toBeUndefined();
  });

  it("元の配列は並べ替えない", () => {
    const rows = [change({ changedAt: 100 }), change({ changedAt: 300 })];
    sortChanges(rows);
    expect(rows.map((c) => c.changedAt)).toEqual([100, 300]);
  });
});

describe("groupChangesByFixedCost", () => {
  it("固定費ごとに、新しい順でまとめる", () => {
    const rows = [
      change({ changedAt: 100, fixedCostId: "a" }),
      change({ changedAt: 300, fixedCostId: "a" }),
      change({ changedAt: 200, fixedCostId: "b" }),
    ];
    const grouped = groupChangesByFixedCost(rows);
    expect(grouped.get("a")!.map((c) => c.changedAt)).toEqual([300, 100]);
    expect(grouped.get("b")!.map((c) => c.changedAt)).toEqual([200]);
    expect(grouped.has("c")).toBe(false);
  });
});

describe("changeDiff / changeDiffLabel", () => {
  it("値上がりはプラス、値下がりはマイナスで出す", () => {
    const up = change({ changedAt: 1, previousAmount: 980, amount: 1_180 });
    const down = change({ changedAt: 1, previousAmount: 1_180, amount: 980 });
    expect(changeDiff(up)).toBe(200);
    expect(changeDiffLabel(up)).toBe("+¥200");
    expect(changeDiff(down)).toBe(-200);
    expect(changeDiffLabel(down)).toBe("−¥200");
  });

  it("桁区切りを入れる", () => {
    expect(changeDiffLabel(change({ changedAt: 1, previousAmount: 0, amount: 12_345 }))).toBe("+¥12,345");
  });
});
