/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { usePullToRefresh } from "./usePullToRefresh";
import { PullToRefreshIndicator } from "../components/ui/PullToRefreshIndicator";

function Page({ onRefresh, disabled = false }: { onRefresh: () => unknown; disabled?: boolean }) {
  const pull = usePullToRefresh(onRefresh, { disabled });
  return (
    <div ref={pull.containerRef} data-testid="page">
      <PullToRefreshIndicator ref={pull.indicatorRef} phase={pull.phase} />
      <div data-testid="list">
        <p data-testid="row">メール</p>
      </div>
      <div role="dialog">
        <p data-testid="sheet">シートの中</p>
      </div>
    </div>
  );
}

/** jsdom の TouchEvent は Touch を作れないので、指の位置を持たせた出来事をそのまま投げる。 */
function touch(target: Element, type: "touchstart" | "touchmove" | "touchend" | "touchcancel", x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = type === "touchend" || type === "touchcancel" ? [] : [{ identifier: 0, clientX: x, clientY: y }];
  Object.defineProperty(event, "touches", { value: touches });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function pull(target: Element, distance: number, dx = 0) {
  touch(target, "touchstart", 100, 100);
  const first = touch(target, "touchmove", 100 + dx / 4, 100 + distance / 4);
  touch(target, "touchmove", 100 + dx, 100 + distance);
  touch(target, "touchend", 100 + dx, 100 + distance);
  return first;
}

function indicator(): HTMLElement {
  return document.querySelector(".pull-indicator") as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("引っ張って更新(A-7)", () => {
  it("一番上で下へ十分に引いて離すと同期する", async () => {
    const onRefresh = vi.fn(async () => undefined);
    render(<Page onRefresh={onRefresh} />);
    const first = pull(screen.getByTestId("row"), 160);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(indicator().dataset.phase).toBe("refreshing");
    // 画面の伸び(iPhone のゴム・Android の再読み込み)は止める。
    expect(first.defaultPrevented).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(indicator().dataset.phase).toBe("idle");
  });

  it("引く量が足りなければ同期しない", () => {
    const onRefresh = vi.fn();
    render(<Page onRefresh={onRefresh} />);
    pull(screen.getByTestId("row"), 80);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(indicator().dataset.phase).toBe("idle");
  });

  it("引いている間は、同期する所を越えたかを目印に出す", () => {
    render(<Page onRefresh={vi.fn()} />);
    const row = screen.getByTestId("row");
    touch(row, "touchstart", 100, 100);
    touch(row, "touchmove", 100, 140);
    expect(indicator().dataset.phase).toBe("pulling");
    touch(row, "touchmove", 100, 260);
    expect(indicator().dataset.phase).toBe("armed");
    expect(indicator().style.getPropertyValue("--pull")).toBe("80px");
    touch(row, "touchcancel", 100, 260);
    expect(indicator().dataset.phase).toBe("idle");
  });

  it("一覧が下へスクロールしている時は、ふつうのスクロールのまま", () => {
    const onRefresh = vi.fn();
    render(<Page onRefresh={onRefresh} />);
    Object.defineProperty(screen.getByTestId("list"), "scrollTop", { value: 120, configurable: true });
    const first = pull(screen.getByTestId("row"), 200);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(first.defaultPrevented).toBe(false);
  });

  it("横の払い(行のスワイプ)と上へのスクロールには手を出さない", () => {
    const onRefresh = vi.fn();
    render(<Page onRefresh={onRefresh} />);
    pull(screen.getByTestId("row"), 30, 200);
    const up = pull(screen.getByTestId("row"), -200);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(up.defaultPrevented).toBe(false);
  });

  it("シートの中で引いても同期しない", () => {
    const onRefresh = vi.fn();
    render(<Page onRefresh={onRefresh} />);
    pull(screen.getByTestId("sheet"), 200);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("disabled の時は何もしない", () => {
    const onRefresh = vi.fn();
    render(<Page onRefresh={onRefresh} disabled />);
    pull(screen.getByTestId("row"), 200);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
