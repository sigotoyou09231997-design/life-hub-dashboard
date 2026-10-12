/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { usePageMotion } from "./usePageMotion";

/** 交差の知らせを一度も出さない IntersectionObserver(iPhone で起きた「交差が来ない」状態の再現)。 */
class SilentObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function Page({ tall = false }: { tall?: boolean }) {
  const ref = usePageMotion<HTMLDivElement>("/gmail");
  return (
    <div ref={ref}>
      <section className="glass-card" data-testid="card">
        {tall ? "長い面" : "短い面"}
      </section>
    </div>
  );
}

describe("usePageMotion — 出現の保険", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "Date"] });
    vi.stubGlobal("IntersectionObserver", SilentObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("交差の知らせが来なくても、1.5秒たてば面は現れる(透明のまま残らない)", () => {
    const { getByTestId } = render(<Page />);
    vi.advanceTimersByTime(20); // 面を数える(次の描画)
    expect(getByTestId("card").classList.contains("is-page-reveal")).toBe(true);

    vi.advanceTimersByTime(4000); // 1.5秒待ち + 見張りの間隔 + 出現後の後片付け
    expect(getByTestId("card").classList.contains("is-page-reveal")).toBe(false);
    expect(getByTestId("card").classList.contains("is-page-reveal-in")).toBe(false);
  });

  it("画面の2.5倍より縦に長い面は、はじめから動かさない", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: window.innerHeight * 3 } as DOMRect);
    const { getByTestId } = render(<Page tall />);
    vi.advanceTimersByTime(20);
    expect(getByTestId("card").classList.contains("is-page-reveal")).toBe(false);
    vi.restoreAllMocks();
  });
});
