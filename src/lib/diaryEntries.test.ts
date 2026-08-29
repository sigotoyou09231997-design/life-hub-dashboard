import { describe, expect, it } from "vitest";
import type { DiaryEntry } from "../types";
import { selectStandaloneDiaries } from "./diaryEntries";

function entry(overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return { id: "d1", date: "2026-08-10", body: "本文", createdAt: 1, ...overrides };
}

describe("selectStandaloneDiaries", () => {
  it("drops entries that belong to a trip", () => {
    const rows = [entry({ id: "a" }), entry({ id: "b", tripId: "trip-1" })];
    expect(selectStandaloneDiaries(rows).map((r) => r.id)).toEqual(["a"]);
  });

  it("puts the newest day first", () => {
    const rows = [
      entry({ id: "old", date: "2026-08-01" }),
      entry({ id: "new", date: "2026-08-20" }),
      entry({ id: "mid", date: "2026-08-10" }),
    ];
    expect(selectStandaloneDiaries(rows).map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  it("breaks a same-day tie by the most recently written", () => {
    const rows = [
      entry({ id: "first", date: "2026-08-10", createdAt: 100 }),
      entry({ id: "second", date: "2026-08-10", createdAt: 200 }),
    ];
    expect(selectStandaloneDiaries(rows).map((r) => r.id)).toEqual(["second", "first"]);
  });

  it("returns nothing when every diary belongs to a trip", () => {
    expect(selectStandaloneDiaries([entry({ tripId: "trip-1" })])).toEqual([]);
  });
});
