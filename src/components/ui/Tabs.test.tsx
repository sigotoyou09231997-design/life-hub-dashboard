import { describe, expect, it } from "vitest";
import { tabIndicatorLayout } from "./Tabs";

describe("tabIndicatorLayout", () => {
  it("5個までは1段に並ぶ", () => {
    expect(tabIndicatorLayout(4, 2)).toEqual({ cols: 4, rows: 1, col: 2, row: 0 });
    expect(tabIndicatorLayout(5, 4)).toEqual({ cols: 5, rows: 1, col: 4, row: 0 });
  });

  it("6個は3列×2段になり、2段目のタブは行も進む", () => {
    expect(tabIndicatorLayout(6, 0)).toEqual({ cols: 3, rows: 2, col: 0, row: 0 });
    expect(tabIndicatorLayout(6, 2)).toEqual({ cols: 3, rows: 2, col: 2, row: 0 });
    // お金管理の「カード」= 5番目。折り返して2段目の2列目に来る
    expect(tabIndicatorLayout(6, 4)).toEqual({ cols: 3, rows: 2, col: 1, row: 1 });
    expect(tabIndicatorLayout(6, 5)).toEqual({ cols: 3, rows: 2, col: 2, row: 1 });
  });

  it("見つからないタブ(-1)や範囲外でもはみ出さない", () => {
    expect(tabIndicatorLayout(6, -1)).toEqual({ cols: 3, rows: 2, col: 0, row: 0 });
    expect(tabIndicatorLayout(6, 99)).toEqual({ cols: 3, rows: 2, col: 2, row: 1 });
  });
});
