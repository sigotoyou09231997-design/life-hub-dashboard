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
