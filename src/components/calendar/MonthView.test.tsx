/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MonthView } from "./MonthView";

const MONTH = new Date(2026, 8, 1); // 2026年9月

function renderMonth(over: Partial<Parameters<typeof MonthView>[0]> = {}) {
  render(
    <MonthView
      currentMonth={MONTH}
      onMonthChange={() => {}}
      selectedDate="2026-09-10"
      onSelectDate={() => {}}
      eventDates={new Set<string>()}
      taskDates={new Set<string>()}
      {...over}
    />,
  );
}

/** その日のマスの中にある、色の付いた点の背景色だけを拾う。 */
function dotColorsOn(day: string): string[] {
  const cell = screen.getByText(day).closest("button");
  const dots = cell?.querySelectorAll<HTMLElement>("span[style*='background']") ?? [];
  return [...dots].map((dot) => dot.style.backgroundColor);
}

afterEach(cleanup);

describe("カレンダーの点", () => {
  it("「誰の予定か」の色が渡された日は、その色の点を並べる", () => {
    renderMonth({
      eventDates: new Set(["2026-09-10"]),
      eventDotColors: new Map([["2026-09-10", ["#5e8bbc", "#6ba368"]]]),
    });
    expect(dotColorsOn("10")).toEqual(["rgb(94, 139, 188)", "rgb(107, 163, 104)"]);
  });

  it("色を渡さなければ、これまでどおり既定色の点1つに戻る", () => {
    // 人を1人も登録していない場合。色の指定が無いので、Tailwindのクラス(bg-accent)の
    // ままになり、インラインのbackgroundを持つ点は出ない。
    renderMonth({ eventDates: new Set(["2026-09-10"]) });
    expect(dotColorsOn("10")).toEqual([]);
    const cell = screen.getByText("10").closest("button");
    expect(cell?.querySelector(".bg-accent")).toBeTruthy();
  });

  it("色の付いた日と付いていない日が混ざっても、付いていない日には点を出さない", () => {
    renderMonth({
      eventDates: new Set(["2026-09-10"]),
      eventDotColors: new Map([["2026-09-10", ["#dc6355"]]]),
    });
    expect(dotColorsOn("11")).toEqual([]);
  });
});

describe("マスの中の帯(予定名)", () => {
  const chips = new Map([
    [
      "2026-09-10",
      [
        { key: "a", label: "打ち合わせ", color: "#5e8bbc", kind: "event" as const },
        { key: "b", label: "家賃 ¥80,000", color: "#9a7bb8", kind: "fixedCost" as const },
      ],
    ],
  ]);

  it("渡された日に、予定名がそのまま帯として並ぶ", () => {
    renderMonth({ dayChips: chips });
    expect(screen.getByText("打ち合わせ")).toBeTruthy();
    expect(screen.getByText("家賃 ¥80,000")).toBeTruthy();
  });

  it("固定費の帯は、予定の帯と見分けが付く印を持つ", () => {
    renderMonth({ dayChips: chips });
    expect(screen.getByText("打ち合わせ").className).not.toContain("is-fixed-cost");
    expect(screen.getByText("家賃 ¥80,000").className).toContain("is-fixed-cost");
  });

  it("帯を出す画面では、予定の色の点は出さない(同じことを二度言わないため)", () => {
    renderMonth({
      dayChips: chips,
      eventDates: new Set(["2026-09-10"]),
      eventDotColors: new Map([["2026-09-10", ["#5e8bbc"]]]),
    });
    expect(dotColorsOn("10")).toEqual([]);
  });

  it("帯を渡さない画面は、今までどおり点だけになる", () => {
    renderMonth({ eventDates: new Set(["2026-09-10"]) });
    expect(screen.queryByText("打ち合わせ")).toBeNull();
  });
});
