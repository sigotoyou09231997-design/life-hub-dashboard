import { describe, expect, it } from "vitest";
import { tabGridLayout } from "./Tabs";

describe("tabGridLayout", () => {
  it("5個までは1段に並ぶ", () => {
    expect(tabGridLayout(2)).toEqual({ cols: 2, rows: 1 });
    expect(tabGridLayout(4)).toEqual({ cols: 4, rows: 1 });
    expect(tabGridLayout(5)).toEqual({ cols: 5, rows: 1 });
  });

  it("6個は3列×2段になる（お金管理のタブ）", () => {
    expect(tabGridLayout(6)).toEqual({ cols: 3, rows: 2 });
  });

  it("表に無い数でも3列で並べる", () => {
    expect(tabGridLayout(7)).toEqual({ cols: 3, rows: 3 });
    expect(tabGridLayout(0)).toEqual({ cols: 3, rows: 1 });
  });
});
