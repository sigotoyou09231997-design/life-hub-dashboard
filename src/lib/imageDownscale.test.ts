import { describe, expect, it } from "vitest";
import { MAX_IMAGE_EDGE, fitWithin } from "./imageDownscale";

describe("fitWithin", () => {
  it("長辺が上限に収まるように縮める(縦横の比は保つ)", () => {
    expect(fitWithin(4032, 3024, MAX_IMAGE_EDGE)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, MAX_IMAGE_EDGE)).toEqual({ width: 1200, height: 1600 });
  });

  it("元から小さい写真は拡大しない", () => {
    // 引き伸ばしても読み取れる文字は増えず、送る量だけが増える。
    expect(fitWithin(800, 600, MAX_IMAGE_EDGE)).toEqual({ width: 800, height: 600 });
  });

  it("細長い写真でも、どちらの辺も1px以上残す", () => {
    // 0pxのcanvasには描画できない(縮める処理ごと失敗する)。
    expect(fitWithin(10_000, 3, MAX_IMAGE_EDGE).height).toBeGreaterThanOrEqual(1);
  });

  it("大きさが読み取れない画像は0で返す(呼び出し側が元の写真を使う)", () => {
    expect(fitWithin(0, 0, MAX_IMAGE_EDGE)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(Number.NaN, 100, MAX_IMAGE_EDGE)).toEqual({ width: 0, height: 0 });
  });
});
