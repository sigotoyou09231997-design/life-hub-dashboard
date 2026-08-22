import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  isOverdue,
  advanceByRepeat,
  tripDayList,
  tripDurationLabel,
  tripCountdownLabel,
  formatCompactDate,
  formatShortDate,
} from "./date";

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

describe("tripDayList", () => {
  it("returns a single day for a day trip", () => {
    expect(tripDayList("2026-08-15", "2026-08-15")).toEqual(["2026-08-15"]);
  });

  it("lists every day for a multi-day trip", () => {
    expect(tripDayList("2026-08-15", "2026-08-18")).toEqual([
      "2026-08-15",
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
    ]);
  });

  it("spans a month-end boundary", () => {
    expect(tripDayList("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });

  it("spans a year-end boundary", () => {
    expect(tripDayList("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("includes Feb 29 for a trip crossing a leap year", () => {
    expect(tripDayList("2028-02-27", "2028-03-01")).toEqual([
      "2028-02-27",
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("returns an empty list when the end date precedes the start date", () => {
    expect(tripDayList("2026-08-15", "2026-08-10")).toEqual([]);
  });
});

describe("tripDurationLabel", () => {
  it("labels a same-day trip as a day trip", () => {
    expect(tripDurationLabel("2026-08-15", "2026-08-15")).toBe("日帰り");
  });

  it("labels a multi-day trip as n泊m日", () => {
    expect(tripDurationLabel("2026-08-15", "2026-08-18")).toBe("3泊4日");
  });

  it("counts nights correctly across a leap-year February", () => {
    expect(tripDurationLabel("2028-02-27", "2028-03-01")).toBe("3泊4日");
  });
});

describe("formatCompactDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0)); // 2026-08-15 12:00
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses words for today, tomorrow and yesterday", () => {
    expect(formatCompactDate("2026-08-15")).toBe("今日");
    expect(formatCompactDate("2026-08-16")).toBe("明日");
    expect(formatCompactDate("2026-08-14")).toBe("昨日");
  });

  it("drops the year within the current year", () => {
    expect(formatCompactDate("2026-12-31")).toBe("12/31(木)");
  });

  it("keeps the year for other years", () => {
    expect(formatCompactDate("2025-12-31")).toBe("2025/12/31");
  });

  it("passes an unparseable value through untouched", () => {
    expect(formatCompactDate("いつか")).toBe("いつか");
  });
});

describe("tripCountdownLabel", () => {
  const today = "2026-08-22";

  it("counts down the days before departure", () => {
    expect(tripCountdownLabel("2026-08-25", "2026-08-27", today)).toBe("あと3日");
  });

  it("says 明日から and 今日から at the edges", () => {
    expect(tripCountdownLabel("2026-08-23", "2026-08-25", today)).toBe("明日から");
    expect(tripCountdownLabel("2026-08-22", "2026-08-25", today)).toBe("今日から");
  });

  it("switches to the day count once the trip has started", () => {
    expect(tripCountdownLabel("2026-08-20", "2026-08-25", today)).toBe("3日目");
    // 最終日も旅行中なので「日目」のまま。
    expect(tripCountdownLabel("2026-08-20", "2026-08-22", today)).toBe("3日目");
  });

  it("says nothing once the trip is over, or when the dates are unusable", () => {
    expect(tripCountdownLabel("2026-08-10", "2026-08-12", today)).toBe("");
    expect(tripCountdownLabel("いつか", "2026-08-25", today)).toBe("");
  });
});

describe("formatShortDate", () => {
  it("keeps the weekday but drops the 月日 characters, so two fit side by side", () => {
    expect(formatShortDate("2026-08-22")).toBe("8/22(土)");
    expect(formatShortDate("2026-12-05")).toBe("12/5(土)");
  });

  it("passes an unparseable value through untouched", () => {
    expect(formatShortDate("")).toBe("");
    expect(formatShortDate("いつか")).toBe("いつか");
  });
});
