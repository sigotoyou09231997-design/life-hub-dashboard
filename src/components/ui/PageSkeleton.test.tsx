// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageSkeleton } from "./PageSkeleton";

/** 読み込み中の下書き(2026-11-09)。すぐ終わる読み込みでちらつかないよう、少し待ってから出す。 */
describe("PageSkeleton", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("delayMs までは何も知らせず、たったら「読み込み中」の下書きを出す", () => {
    render(<PageSkeleton delayMs={400} />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => void vi.advanceTimersByTime(400));
    expect(screen.getByRole("status", { name: "読み込み中" })).toBeTruthy();
  });

  it("delayMs が 0 なら、すぐ出す", () => {
    render(<PageSkeleton delayMs={0} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
