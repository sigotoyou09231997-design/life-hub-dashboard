/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { FeedbackGauge } from "./FeedbackGauge";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("FeedbackGauge", () => {
  it("修正中で目安がある時だけ出る。進み具合は progressbar と文で分かる", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T00:03:00Z"));
    render(<FeedbackGauge item={{ status: "working", workingAt: "2026-10-14T00:00:00Z", estimateMinutes: 6 }} />);
    const bar = screen.getByRole("progressbar", { name: "修正の進み具合(目安)" });
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect(bar.getAttribute("aria-valuemax")).toBe("6");
    expect(screen.getByText("目安 約6分・経過 3分・あと約3分")).toBeTruthy();
  });

  it("目安が付いていない・修正中でない依頼には、何も出さない(035 のころの修正中・対応済み・保留中)", () => {
    const { container, rerender } = render(<FeedbackGauge item={{ status: "working", workingAt: "2026-10-14T00:00:00Z" }} />);
    expect(container.textContent).toBe("");
    rerender(<FeedbackGauge item={{ status: "done", workingAt: "2026-10-14T00:00:00Z", estimateMinutes: 6 }} />);
    expect(container.textContent).toBe("");
    rerender(<FeedbackGauge item={{ status: "hold", estimateMinutes: 6 }} />);
    expect(container.textContent).toBe("");
  });

  it("開いたままでも時間が進む。目安を過ぎたら「過ぎています」に変わる", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T00:05:00Z"));
    render(<FeedbackGauge item={{ status: "working", workingAt: "2026-10-14T00:00:00Z", estimateMinutes: 6 }} />);
    expect(screen.getByText(/あと約1分/)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(screen.getByText(/目安の約6分を過ぎています/)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("6");
  });
});
