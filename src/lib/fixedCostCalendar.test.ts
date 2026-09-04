import { describe, expect, it } from "vitest";
import { collectFixedCostChipsInRange, dueDateInMonth } from "./fixedCostCalendar";
import type { FixedCost } from "../types";

function cost(over: Partial<FixedCost>): FixedCost {
  return { title: "家賃", category: "家賃", amount: 80_000, dueDay: 27, active: true, ...over };
}

describe("dueDateInMonth", () => {
  it("その月の支払日を出す", () => {
    expect(dueDateInMonth(27, "2026-09-01")).toBe("2026-09-27");
  });

  it("31日が支払日の月は末日に丸める", () => {
    expect(dueDateInMonth(31, "2026-02-01")).toBe("2026-02-28");
    expect(dueDateInMonth(31, "2026-04-01")).toBe("2026-04-30");
    expect(dueDateInMonth(31, "2026-05-01")).toBe("2026-05-31");
  });

  it("範囲外の値は1日〜末日に収める", () => {
    expect(dueDateInMonth(0, "2026-09-01")).toBe("2026-09-01");
    expect(dueDateInMonth(99, "2026-09-01")).toBe("2026-09-30");
  });
});

describe("collectFixedCostChipsInRange", () => {
  it("月表示の枠にかかる月ぶんの支払日を出す(前後の月にはみ出す週も含む)", () => {
    const chips = collectFixedCostChipsInRange(
      [cost({ id: "a", dueDay: 1 }), cost({ id: "b", title: "通信費", amount: 4_500, dueDay: 27 })],
      "2026-08-31",
      "2026-10-04",
    );
    expect([...chips.keys()].sort()).toEqual(["2026-09-01", "2026-09-27", "2026-10-01"]);
    expect(chips.get("2026-09-27")?.[0].label).toBe("通信費 ¥4,500");
  });

  it("止めている固定費は出さない", () => {
    const chips = collectFixedCostChipsInRange([cost({ id: "a", active: false })], "2026-09-01", "2026-09-30");
    expect(chips.size).toBe(0);
  });

  it("範囲の外にある支払日は出さない", () => {
    const chips = collectFixedCostChipsInRange([cost({ id: "a", dueDay: 27 })], "2026-09-01", "2026-09-20");
    expect(chips.size).toBe(0);
  });

  it("帯は固定費として印を付ける(予定と見分けるため)", () => {
    const chips = collectFixedCostChipsInRange([cost({ id: "a" })], "2026-09-01", "2026-09-30");
    expect(chips.get("2026-09-27")?.[0].kind).toBe("fixedCost");
  });
});
