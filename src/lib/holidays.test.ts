import { describe, it, expect } from "vitest";
import { getJapaneseHolidays, getHolidayMapForYear, getHolidayMapForYears } from "./holidays";

describe("getJapaneseHolidays", () => {
  it("computes fixed-date and happy-monday holidays for 2024", () => {
    const map = new Map(getJapaneseHolidays(2024).map((h) => [h.date, h.name]));
    expect(map.get("2024-01-01")).toBe("元日");
    expect(map.get("2024-01-08")).toBe("成人の日"); // 2nd Monday
    expect(map.get("2024-07-15")).toBe("海の日"); // 3rd Monday
    expect(map.get("2024-09-16")).toBe("敬老の日"); // 3rd Monday
    expect(map.get("2024-10-14")).toBe("スポーツの日"); // 2nd Monday
  });

  it("computes equinox days", () => {
    const map2024 = new Map(getJapaneseHolidays(2024).map((h) => [h.date, h.name]));
    expect(map2024.get("2024-03-20")).toBe("春分の日");
    expect(map2024.get("2024-09-22")).toBe("秋分の日");
  });

  it("adds a substitute holiday (振替休日) when a holiday falls on Sunday", () => {
    const map = new Map(getJapaneseHolidays(2024).map((h) => [h.date, h.name]));
    // 2024-02-11 (建国記念の日) is a Sunday
    expect(map.get("2024-02-11")).toBe("建国記念の日");
    expect(map.get("2024-02-12")).toBe("振替休日");
    // 2024-05-05 (こどもの日) is a Sunday
    expect(map.get("2024-05-06")).toBe("振替休日");
  });

  it("adds a citizen's holiday (国民の休日) for the 2026 silver-week gap", () => {
    const map = new Map(getJapaneseHolidays(2026).map((h) => [h.date, h.name]));
    expect(map.get("2026-09-21")).toBe("敬老の日");
    expect(map.get("2026-09-22")).toBe("国民の休日");
    expect(map.get("2026-09-23")).toBe("秋分の日");
  });

  it("never lands a computed holiday date out of its month", () => {
    for (let year = 2020; year <= 2035; year++) {
      for (const h of getJapaneseHolidays(year)) {
        const [y, m, d] = h.date.split("-").map(Number);
        expect(y).toBe(year);
        expect(m).toBeGreaterThanOrEqual(1);
        expect(m).toBeLessThanOrEqual(12);
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(31);
      }
    }
  });
});

describe("getHolidayMapForYear / getHolidayMapForYears", () => {
  it("caches per year and returns a lookup map", () => {
    const map = getHolidayMapForYear(2025);
    expect(map.get("2025-01-01")).toBe("元日");
  });

  it("merges holidays across a Dec/Jan month-grid boundary", () => {
    const merged = getHolidayMapForYears([2024, 2025]);
    expect(merged.get("2024-11-23")).toBe("勤労感謝の日");
    expect(merged.get("2025-01-01")).toBe("元日");
  });
});
