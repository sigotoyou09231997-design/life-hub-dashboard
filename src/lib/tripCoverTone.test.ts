import { describe, expect, it } from "vitest";
import { TRIP_COVER_TONES, tripCoverPlace, tripCoverTone } from "./tripCoverTone";

describe("旅行の表紙の色の面", () => {
  it("同じ行き先はいつも同じ色、色は決めた6色のどれか", () => {
    expect(tripCoverTone("京都")).toEqual(tripCoverTone("京都"));
    expect(TRIP_COVER_TONES).toContainEqual(tripCoverTone("草津"));
  });

  it("地名は行き先の区切りの手前。行き先が無ければ旅行の名前", () => {
    expect(tripCoverPlace("秋の京都", "京都・大阪")).toBe("京都");
    expect(tripCoverPlace("冬の温泉", "")).toBe("冬の温泉");
  });
});
