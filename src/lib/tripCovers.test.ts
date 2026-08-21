import { describe, expect, it } from "vitest";
import { tripCoverImage } from "./tripCovers";

describe("tripCoverImage", () => {
  it("returns the same cover for the same seed", () => {
    expect(tripCoverImage("石川県 金沢市")).toBe(tripCoverImage("石川県 金沢市"));
  });

  it("returns a real background asset path", () => {
    expect(tripCoverImage("沖縄県 那覇市")).toMatch(/^\/backgrounds\/.+\.jpg$/);
  });

  it("spreads different destinations over more than one cover", () => {
    const seeds = ["金沢", "那覇", "札幌", "京都", "福岡", "松本", "長崎", "仙台"];
    const covers = new Set(seeds.map(tripCoverImage));
    expect(covers.size).toBeGreaterThan(1);
  });

  it("handles an empty seed without throwing", () => {
    expect(tripCoverImage("")).toMatch(/^\/backgrounds\/.+\.jpg$/);
  });
});
