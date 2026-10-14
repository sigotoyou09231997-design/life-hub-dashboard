import { describe, expect, it } from "vitest";
import { TRIP_TAB_OPTIONS, VALID_TRIP_TABS } from "./tripTabs";

describe("旅行の画面のタブの並び(2026-10-14、要望「ルートは日程の横がいい」)", () => {
  it("ルートは日程のすぐ隣。続けて、費用・持ち物・日記・書類", () => {
    expect(TRIP_TAB_OPTIONS.map((option) => option.label)).toEqual(["日程", "ルート", "費用", "持ち物", "日記", "書類"]);
  });

  it("開く時に使えるタブの一覧は、並びと同じ6つ(1つも抜けない・増えない)", () => {
    expect(VALID_TRIP_TABS).toEqual(["schedule", "route", "expense", "packing", "diary", "documents"]);
  });
});
