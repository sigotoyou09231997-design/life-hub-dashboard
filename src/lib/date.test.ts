import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { isOverdue, advanceByRepeat } from "./date";

describe("isOverdue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0)); // 2026-08-15 12:00
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false when there is no due date", () => {
    expect(isOverdue(undefined)).toBe(false);
  });

  it("treats a past date as overdue", () => {
    expect(isOverdue("2026-08-10")).toBe(true);
  });

  it("treats a future date as not overdue", () => {
    expect(isOverdue("2026-08-20")).toBe(false);
  });

  it("without a time, today is not overdue until the day ends (23:59:59)", () => {
    expect(isOverdue("2026-08-15")).toBe(false);
  });

  it("with a time, today is overdue only once that time has passed", () => {
    expect(isOverdue("2026-08-15", "09:00")).toBe(true); // already past noon
    expect(isOverdue("2026-08-15", "18:00")).toBe(false); // still ahead
  });
});

describe("advanceByRepeat", () => {
  it("leaves the date unchanged when repeat is none", () => {
    expect(advanceByRepeat("2026-08-15", "none")).toBe("2026-08-15");
  });

  it("adds a day/week for daily/weekly repeats", () => {
    expect(advanceByRepeat("2026-08-15", "daily")).toBe("2026-08-16");
    expect(advanceByRepeat("2026-08-15", "weekly")).toBe("2026-08-22");
  });

  it("advances a normal monthly repeat by one calendar month", () => {
    expect(advanceByRepeat("2026-03-15", "monthly")).toBe("2026-04-15");
  });

  it("clamps a month-end repeat to the shorter following month", () => {
    // 2026 is not a leap year, so Jan 31 -> Feb 28.
    expect(advanceByRepeat("2026-01-31", "monthly")).toBe("2026-02-28");
  });

  it("clamps to Feb 29 in a leap year", () => {
    expect(advanceByRepeat("2028-01-31", "monthly")).toBe("2028-02-29");
  });

  it("crosses the year boundary correctly", () => {
    expect(advanceByRepeat("2026-12-25", "monthly")).toBe("2027-01-25");
  });
});
