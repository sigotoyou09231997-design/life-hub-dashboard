import { describe, expect, it } from "vitest";
import {
  COVER_CACHE_TTL_MS,
  COVER_MISS_TTL_MS,
  coverCacheKey,
  isFreshCoverEntry,
  parseCoverEntry,
  tripCoverImage,
  tripCoverPhotoUrl,
} from "./tripCovers";

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

describe("表紙のキャッシュ", () => {
  it("行き先と名前の両方でキーが変わる（名前を直せば探し直す）", () => {
    expect(coverCacheKey("夏の旅行", "鎌倉")).not.toBe(coverCacheKey("夏の旅行", "京都"));
    expect(coverCacheKey("夏の旅行", "鎌倉")).toBe(coverCacheKey(" 夏の旅行 ", " 鎌倉 "));
  });

  it("写真が見つかった時は長く、見つからなかった時は短く覚える", () => {
    const now = Date.now();
    const found = { photo: "places/x/photos/y", at: now - COVER_MISS_TTL_MS - 1 };
    const missing = { photo: null, at: now - COVER_MISS_TTL_MS - 1 };
    // 見つかっている方は、見つからない方の期限を過ぎてもまだ使う。
    expect(isFreshCoverEntry(found, now)).toBe(true);
    expect(isFreshCoverEntry(missing, now)).toBe(false);
    expect(isFreshCoverEntry({ photo: "places/x/photos/y", at: now - COVER_CACHE_TTL_MS - 1 }, now)).toBe(false);
  });

  it("壊れた覚え書きは無いものとして扱う（聞き直す）", () => {
    expect(parseCoverEntry(null)).toBeNull();
    expect(parseCoverEntry("{")).toBeNull();
    expect(parseCoverEntry('{"photo":"places/x/photos/y"}')).toBeNull();
    expect(parseCoverEntry('{"photo":12,"at":1}')).toBeNull();
    expect(parseCoverEntry('{"photo":null,"at":5}')).toEqual({ photo: null, attribution: undefined, at: 5 });
  });

  it("写真のURLは、キーを出さないようサーバー関数を通す", () => {
    expect(tripCoverPhotoUrl("places/x/photos/y+z")).toBe("/api/tripCover?photo=places%2Fx%2Fphotos%2Fy%2Bz");
  });
});
