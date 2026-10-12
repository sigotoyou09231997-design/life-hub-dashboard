/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { CountingAmount } from "./CountingAmount";

const visibleRect = { top: 100, bottom: 160, left: 20, right: 220, width: 200, height: 60, x: 20, y: 100 } as DOMRect;

function setOnScreen(onScreen: boolean) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    onScreen ? ({ ...visibleRect, toJSON: () => ({}) } as DOMRect) : ({ ...visibleRect, top: -400, bottom: -340, toJSON: () => ({}) } as DOMRect),
  );
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce"), media: query }));
}

function shown(container: HTMLElement) {
  const count = container.querySelector(".num-count")!;
  // 浮かぶ差額を除いた、合計の文字だけ。
  return [...count.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join("");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("値が変わると前の値から数える金額(UI/UX 調査メモ 第4弾 A-5)", () => {
  it("開いた直後はそのまま出し、差額は浮かべない", () => {
    setOnScreen(true);
    setReducedMotion(false);
    const { container } = render(<CountingAmount value={3480} showDelta />);
    expect(shown(container)).toBe("3,480");
    expect(container.querySelector(".num-delta")).toBeNull();
  });

  it("読み込み中は「—」、読み込めた時も数え上げない(0 からの数え上げは useDesignMotion に任せる)", () => {
    setOnScreen(true);
    setReducedMotion(false);
    const { container, rerender } = render(<CountingAmount value={undefined} showDelta />);
    expect(shown(container)).toBe("—");
    rerender(<CountingAmount value={3480} showDelta />);
    expect(shown(container)).toBe("3,480");
    expect(container.querySelector(".num-delta")).toBeNull();
  });

  it("支出を記録して合計が増えると「+¥1,280」が浮かび、合計は前の値から新しい値へ数え上がる", () => {
    setOnScreen(true);
    setReducedMotion(false);
    const { container, rerender } = render(<CountingAmount value={3480} showDelta />);
    rerender(<CountingAmount value={4760} showDelta />);
    // 描いた直後は前の値のまま(新しい値が一瞬ちらつかない)。
    expect(shown(container)).toBe("3,480");
    expect(container.querySelector(".num-delta")?.textContent).toBe("+¥1,280");

    act(() => {
      vi.advanceTimersByTime(800);
    });
    const middle = Number(shown(container).replace(/,/g, ""));
    expect(middle).toBeGreaterThan(3480);
    expect(middle).toBeLessThan(4760);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(shown(container)).toBe("4,760");
    expect(container.querySelector(".num-delta")).toBeNull();
  });

  it("残りが減った時は「−¥1,280」", () => {
    setOnScreen(true);
    setReducedMotion(false);
    const { container, rerender } = render(<CountingAmount value={264520} showDelta />);
    rerender(<CountingAmount value={263240} showDelta />);
    expect(container.querySelector(".num-delta")?.textContent).toBe("−¥1,280");
  });

  it("showDelta が無ければ数え上げだけ(お金管理の「使えるお金」)", () => {
    setOnScreen(true);
    setReducedMotion(false);
    const { container, rerender } = render(<CountingAmount value={264520} />);
    rerender(<CountingAmount value={263240} />);
    expect(shown(container)).toBe("264,520");
    expect(container.querySelector(".num-delta")).toBeNull();
  });

  it("「視差効果を減らす」がオンなら、浮かべずにその場で新しい値にする", () => {
    setOnScreen(true);
    setReducedMotion(true);
    const { container, rerender } = render(<CountingAmount value={3480} showDelta />);
    rerender(<CountingAmount value={4760} showDelta />);
    expect(shown(container)).toBe("4,760");
    expect(container.querySelector(".num-delta")).toBeNull();
  });

  it("画面に見えていない時も、浮かべずにその場で替える", () => {
    setOnScreen(false);
    setReducedMotion(false);
    const { container, rerender } = render(<CountingAmount value={3480} showDelta />);
    rerender(<CountingAmount value={4760} showDelta />);
    expect(shown(container)).toBe("4,760");
    expect(container.querySelector(".num-delta")).toBeNull();
  });

  it("月が替わって合計が 0 に戻った時は動かさない", () => {
    setOnScreen(true);
    setReducedMotion(false);
    const { container, rerender } = render(<CountingAmount value={98000} resetKey="2026-10-01" showDelta />);
    rerender(<CountingAmount value={0} resetKey="2026-11-01" showDelta />);
    expect(shown(container)).toBe("0");
    expect(container.querySelector(".num-delta")).toBeNull();
  });
});
