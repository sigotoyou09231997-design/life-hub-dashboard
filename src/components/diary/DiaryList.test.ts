import { describe, expect, it } from "vitest";
import { groupByMonth } from "./DiaryList";
import type { DiaryEntry } from "../../types";

function entry(date: string): DiaryEntry {
  return { date, body: date, createdAt: 0 };
}

describe("groupByMonth", () => {
  it("月ごとにまとめ、渡された並び順を崩さない", () => {
    const groups = groupByMonth([entry("2026-08-23"), entry("2026-08-01"), entry("2026-07-30")]);
    expect(groups.map((g) => g.label)).toEqual(["2026年8月", "2026年7月"]);
    expect(groups[0].items.map((e) => e.date)).toEqual(["2026-08-23", "2026-08-01"]);
  });

  it("月の表記は0埋めしない", () => {
    expect(groupByMonth([entry("2026-01-05")])[0].label).toBe("2026年1月");
  });

  it("同じ月が離れて出てきたら別の塊にする(並び替えはしない)", () => {
    const groups = groupByMonth([entry("2026-08-23"), entry("2026-07-30"), entry("2026-08-02")]);
    expect(groups.map((g) => g.label)).toEqual(["2026年8月", "2026年7月", "2026年8月"]);
  });

  it("空なら空", () => {
    expect(groupByMonth([])).toEqual([]);
  });
});
