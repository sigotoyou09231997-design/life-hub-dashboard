import { describe, expect, it } from "vitest";
import { selectOnThisDay } from "./diaryEntries";
import type { DiaryEntry } from "../types";

function entry(date: string, body: string, extra: Partial<DiaryEntry> = {}): DiaryEntry {
  return { id: `${date}-${body}`, date, body, createdAt: 0, ...extra };
}

describe("selectOnThisDay", () => {
  it("同じ月日の過去の日記だけを、近い年から返す", () => {
    const entries = [
      entry("2024-09-04", "2年前"),
      entry("2025-09-04", "1年前"),
      entry("2026-09-04", "今日"),
      entry("2025-09-05", "1年前の翌日"),
    ];
    expect(selectOnThisDay(entries, "2026-09-04").map((i) => [i.yearsAgo, i.entry.body])).toEqual([
      [1, "1年前"],
      [2, "2年前"],
    ]);
  });

  it("旅行中に書いた日記も含める", () => {
    const entries = [entry("2025-09-04", "旅行の日", { tripId: "t1" })];
    expect(selectOnThisDay(entries, "2026-09-04")).toHaveLength(1);
  });

  it("該当が無い日は空", () => {
    expect(selectOnThisDay([entry("2025-01-01", "元日")], "2026-09-04")).toEqual([]);
  });

  it("未来の日付は拾わない", () => {
    expect(selectOnThisDay([entry("2027-09-04", "来年")], "2026-09-04")).toEqual([]);
  });

  it("うるう日は、同じ2月29日に書いたものだけが並ぶ(2月28日は拾わない)", () => {
    const entries = [entry("2023-02-28", "前日"), entry("2024-02-29", "うるう日")];
    expect(selectOnThisDay(entries, "2028-02-29").map((i) => i.entry.body)).toEqual(["うるう日"]);
  });

  it("日付として読めない値では何も返さない", () => {
    expect(selectOnThisDay([entry("2025-09-04", "去年")], "")).toEqual([]);
  });
});
