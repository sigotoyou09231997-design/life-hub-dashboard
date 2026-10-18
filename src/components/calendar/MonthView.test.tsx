/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

/** jsdom には PointerEvent が無い。指の位置・pointerId・指かマウスかが渡るものを用意する(SwipeRow.test.tsx と同じ)。 */
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "touch";
    this.isPrimary = init.isPrimary ?? true;
  }
}

describe("指で横へ払って月を変える", () => {
  const WIDTH = 390;

  function setup(over: Partial<Parameters<typeof MonthView>[0]> = {}) {
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ top: 0, bottom: 500, left: 0, right: WIDTH, width: WIDTH, height: 500, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
    const onMonthChange = vi.fn();
    const onSelectDate = vi.fn();
    renderMonth({ onMonthChange, onSelectDate, swipeable: true, ...over });
    return { onMonthChange, onSelectDate, cell: screen.getByText("16").closest("button") as HTMLElement };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** 指で from から to まで動かして離す。 */
  function swipe(target: HTMLElement, from: { x: number; y?: number }, to: { x: number; y?: number }, pointerType = "touch") {
    const y0 = from.y ?? 200;
    const y1 = to.y ?? y0;
    fireEvent.pointerDown(target, { pointerId: 1, pointerType, isPrimary: true, button: 0, clientX: from.x, clientY: y0 });
    fireEvent.pointerMove(target, { pointerId: 1, pointerType, clientX: from.x + (to.x - from.x) / 4, clientY: y0 + (y1 - y0) / 4 });
    fireEvent.pointerMove(target, { pointerId: 1, pointerType, clientX: to.x, clientY: y1 });
    fireEvent.pointerUp(target, { pointerId: 1, pointerType, clientX: to.x, clientY: y1 });
  }

  function monthOf(fn: ReturnType<typeof vi.fn>): string {
    const date = fn.mock.calls[0][0] as Date;
    return `${date.getFullYear()}-${date.getMonth() + 1}`;
  }

  it("左へ払うと次の月、右へ払うと前の月になる", () => {
    const { onMonthChange, cell } = setup();
    swipe(cell, { x: 300 }, { x: 150 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onMonthChange).toHaveBeenCalledTimes(1);
    expect(monthOf(onMonthChange)).toBe("2026-10");

    onMonthChange.mockClear();
    swipe(cell, { x: 100 }, { x: 260 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onMonthChange).toHaveBeenCalledTimes(1);
    expect(monthOf(onMonthChange)).toBe("2026-8");
  });

  it("払い終えた指を離しても、そのマスの日は選ばない(予定の追加が開かない)", () => {
    const { onSelectDate, cell } = setup();
    swipe(cell, { x: 300 }, { x: 150 });
    fireEvent.click(cell);
    expect(onSelectDate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // しばらくたって普通に押せば、今までどおり選べる。
    fireEvent.click(cell);
    expect(onSelectDate).toHaveBeenCalledWith("2026-09-16");
  });

  it("縦に動かした指(スクロール)・少しだけ動かした指では、月を変えない", () => {
    const { onMonthChange, cell } = setup();
    swipe(cell, { x: 200, y: 300 }, { x: 230, y: 120 });
    swipe(cell, { x: 200 }, { x: 170 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onMonthChange).not.toHaveBeenCalled();
  });

  it("マウスで引っ張っても動かない(パソコンは ‹ › のボタンで動かす)", () => {
    const { onMonthChange, cell } = setup();
    swipe(cell, { x: 300 }, { x: 100 }, "mouse");
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onMonthChange).not.toHaveBeenCalled();
  });

  it("画面の左端から触り始めた指は使わない(iPhone の「戻る」に譲る)", () => {
    const { onMonthChange, cell } = setup();
    swipe(cell, { x: 8 }, { x: 200 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onMonthChange).not.toHaveBeenCalled();
  });

  it("払えるようにしていないカレンダー(日付を選ぶだけの小さなもの)では動かない", () => {
    const { onMonthChange, cell } = setup({ swipeable: false });
    swipe(cell, { x: 300 }, { x: 100 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onMonthChange).not.toHaveBeenCalled();
  });
});
