/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COVER_CACHE_TTL_MS,
  COVER_MISS_TTL_MS,
  coverCacheKey,
  describeCoverAnswer,
  isFreshCoverEntry,
  parseCoverEntry,
  resolveTripCover,
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

describe("describeCoverAnswer", () => {
  it("キーが未設定なら、そう言う", () => {
    expect(describeCoverAnswer({ configured: false }).ok).toBe(false);
    expect(describeCoverAnswer({ configured: false }).message).toContain("GOOGLE_MAPS_API_KEY");
  });

  it("Googleに断られた時は、Places APIの有効化まで案内する", () => {
    const probe = describeCoverAnswer({ configured: true, query: "鎌倉", error: "403 PERMISSION_DENIED" });
    expect(probe.ok).toBe(false);
    expect(probe.message).toContain("Places API (New)");
    expect(probe.message).toContain("403 PERMISSION_DENIED");
  });

  it("写真が見つからない時は、検索語を見せる", () => {
    const probe = describeCoverAnswer({ configured: true, query: "どこか", cover: null });
    expect(probe.ok).toBe(false);
    expect(probe.message).toContain("どこか");
  });

  it("見つかった時は、その写真のURLを返す", () => {
    const probe = describeCoverAnswer({
      configured: true,
      query: "鎌倉 由比ヶ浜",
      cover: { photo: "places/x/photos/y" },
    });
    expect(probe.ok).toBe(true);
    expect(probe.url).toBe(tripCoverPhotoUrl("places/x/photos/y"));
  });
});

describe("resolveTripCover の覚え書き", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function answerWith(body: unknown): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
  }

  it("サーバーにキーがまだ無い時は、見つからなかったことを覚えない", async () => {
    // 覚えてしまうと、キーを入れて直したあとも3日間は同梱の写真のままになる。
    answerWith({ configured: false });
    expect(await resolveTripCover("神奈川旅行", "鎌倉")).toBeNull();
    expect(localStorage.getItem(coverCacheKey("神奈川旅行", "鎌倉"))).toBeNull();
  });

  it("キーがあって写真が無かった時は、覚えて聞き直さない", async () => {
    // こちらは本当に「その土地の写真が無い」ので、開くたびに課金される呼び出しを避ける。
    answerWith({ configured: true, query: "どこか", cover: null });
    expect(await resolveTripCover("どこか旅行", "")).toBeNull();
    expect(parseCoverEntry(localStorage.getItem(coverCacheKey("どこか旅行", "")))?.photo).toBeNull();
  });

  it("写真が見つかったら、それを覚えて返す", async () => {
    answerWith({ configured: true, query: "鎌倉", cover: { photo: "places/abc", attribution: "撮影者" } });
    const resolved = await resolveTripCover("神奈川旅行", "鎌倉");
    expect(resolved?.url).toBe(tripCoverPhotoUrl("places/abc"));
    expect(parseCoverEntry(localStorage.getItem(coverCacheKey("神奈川旅行", "鎌倉")))?.photo).toBe("places/abc");
  });
});
