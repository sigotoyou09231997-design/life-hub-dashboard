import { describe, expect, it } from "vitest";
import { isLifeMarker } from "./scheduleRhythm";

describe("生活の区切りの予定(第6弾 D-4)", () => {
  it("起床・準備・自宅出発などで、場所が無いか自宅なら区切り", () => {
    expect(isLifeMarker({ title: "起床" })).toBe(true);
    expect(isLifeMarker({ title: "準備" })).toBe(true);
    expect(isLifeMarker({ title: "自宅出発", location: "自宅" })).toBe(true);
    expect(isLifeMarker({ title: "出発 (車で)" })).toBe(true);
    expect(isLifeMarker({ title: " 朝食 " })).toBe(true);
  });

  it("店の場所が入っている朝食や、観光地の予定は区切りにしない", () => {
    expect(isLifeMarker({ title: "朝食", location: "ホテルのレストラン" })).toBe(false);
    expect(isLifeMarker({ title: "霊山寺" })).toBe(false);
    expect(isLifeMarker({ title: "出発前に準備" })).toBe(false);
    expect(isLifeMarker({ title: "東京駅出発" })).toBe(false);
  });
});
