import { describe, expect, it } from "vitest";
import { isRepeating, makeWeekdayRepeat, parseWeekdayRepeat, repeatLabel } from "./repeatRule";

describe("makeWeekdayRepeat", () => {
  it("sorts and de-duplicates the chosen days", () => {
    expect(makeWeekdayRepeat([5, 1, 3, 1])).toBe("weekdays:1,3,5");
  });

  it("falls back to none when nothing is chosen or nothing is usable", () => {
    expect(makeWeekdayRepeat([])).toBe("none");
    expect(makeWeekdayRepeat([7, -1, 1.5])).toBe("none");
  });
});

describe("parseWeekdayRepeat", () => {
  it("reads the days back out", () => {
    expect(parseWeekdayRepeat("weekdays:1,3,5")).toEqual([1, 3, 5]);
    expect(parseWeekdayRepeat("weekdays:0")).toEqual([0]);
  });

  it("returns null for the fixed choices and for nothing at all", () => {
    expect(parseWeekdayRepeat("none")).toBeNull();
    expect(parseWeekdayRepeat("weekly")).toBeNull();
    expect(parseWeekdayRepeat(undefined)).toBeNull();
  });

  it("returns null rather than guessing when the value is damaged", () => {
    expect(parseWeekdayRepeat("weekdays:" as never)).toBeNull();
    expect(parseWeekdayRepeat("weekdays:9,x" as never)).toBeNull();
    // 一部だけ読めるなら、読めた分は活かす。
    expect(parseWeekdayRepeat("weekdays:9,2" as never)).toEqual([2]);
  });
});

describe("isRepeating", () => {
  it("treats the fixed choices and a valid weekday rule as repeating", () => {
    expect(isRepeating("daily")).toBe(true);
    expect(isRepeating("weekdays:2,4")).toBe(true);
  });

  it("treats none, undefined and a damaged weekday rule as one-off", () => {
    expect(isRepeating("none")).toBe(false);
    expect(isRepeating(undefined)).toBe(false);
    expect(isRepeating("weekdays:" as never)).toBe(false);
  });
});

describe("repeatLabel", () => {
  it("names the days for a weekday rule", () => {
    expect(repeatLabel("weekdays:1,3,5")).toBe("毎週月・水・金");
    expect(repeatLabel("weekdays:0,6")).toBe("毎週日・土");
  });

  it("keeps the short words for the fixed choices", () => {
    expect(repeatLabel("daily")).toBe("毎日");
    expect(repeatLabel("monthly")).toBe("毎月");
    expect(repeatLabel("none")).toBe("");
  });
});
