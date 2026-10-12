/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { RING_CELEBRATED_KEY } from "../lib/taskCelebration";
import { useTaskRingCelebration } from "./useTaskRingCelebration";

const TODAY = "2026-10-12";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderRing(total: number, completed: number) {
  return renderHook(({ t, c }) => useTaskRingCelebration(t, c, TODAY), { initialProps: { t: total, c: completed } });
}

describe("今日の輪を光らせる(A-4)", () => {
  it("最後の1件を終えた時に光り、しばらくして消える。光らせた日を覚える", () => {
    const { result, rerender } = renderRing(2, 1);
    expect(result.current).toBe(false);
    rerender({ t: 2, c: 2 });
    expect(result.current).toBe(true);
    expect(localStorage.getItem(RING_CELEBRATED_KEY)).toBe(TODAY);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current).toBe(false);
  });

  it("同じ日の2回目は光らない", () => {
    localStorage.setItem(RING_CELEBRATED_KEY, TODAY);
    const { result, rerender } = renderRing(2, 1);
    rerender({ t: 2, c: 2 });
    expect(result.current).toBe(false);
  });

  it("開いた時にもう全部終わっていた時は光らない", () => {
    const { result } = renderRing(3, 3);
    expect(result.current).toBe(false);
    expect(localStorage.getItem(RING_CELEBRATED_KEY)).toBeNull();
  });

  it("動きを減らす設定の時は光らせないが、その日の1回は使ったことにする", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    const { result, rerender } = renderRing(1, 0);
    rerender({ t: 1, c: 1 });
    expect(result.current).toBe(false);
    expect(localStorage.getItem(RING_CELEBRATED_KEY)).toBe(TODAY);
  });
});
