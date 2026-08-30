import { describe, expect, it } from "vitest";
import {
  SYSTEM_PROMPT,
  fallbackPlaceQuery,
  isPlacePhotoName,
  parsePlaceQueryResponse,
  parsePlacesResponse,
} from "../functions/tripCover";
import {
  SYSTEM_PROMPT as VERCEL_SYSTEM_PROMPT,
  fallbackPlaceQuery as vercelFallbackPlaceQuery,
  isPlacePhotoName as vercelIsPlacePhotoName,
  parsePlaceQueryResponse as vercelParsePlaceQueryResponse,
  parsePlacesResponse as vercelParsePlacesResponse,
} from "../../api/tripCover";

describe("isPlacePhotoName", () => {
  it("Places APIが返す形だけを通す", () => {
    expect(isPlacePhotoName("places/ChIJ_abc-123/photos/AWU5eF-xyz_9")).toBe(true);
  });

  it("それ以外は弾く（任意の場所へ通信させられないように）", () => {
    expect(isPlacePhotoName("https://example.com/photo.jpg")).toBe(false);
    expect(isPlacePhotoName("places/abc/photos/../../secret")).toBe(false);
    expect(isPlacePhotoName("")).toBe(false);
    expect(isPlacePhotoName(undefined)).toBe(false);
  });
});

describe("parsePlaceQueryResponse", () => {
  it("JSONから検索語を取り出す", () => {
    expect(parsePlaceQueryResponse('{"query": "鎌倉 由比ヶ浜"}')).toBe("鎌倉 由比ヶ浜");
  });

  it("前置きが混ざっていても拾う", () => {
    expect(parsePlaceQueryResponse('はい。\n{"query":"札幌 大通公園"}')).toBe("札幌 大通公園");
  });

  it("読み取れなければ空にする（呼び出し側が行き先で代用する）", () => {
    expect(parsePlaceQueryResponse("わかりません")).toBe("");
    expect(parsePlaceQueryResponse('{"query": 12}')).toBe("");
  });
});

describe("fallbackPlaceQuery", () => {
  it("行き先を優先する", () => {
    expect(fallbackPlaceQuery("夏の旅行", "神奈川 鎌倉")).toBe("神奈川 鎌倉");
  });

  it("行き先が無ければタイトルから「旅行」を落として使う", () => {
    expect(fallbackPlaceQuery("神奈川旅行", "")).toBe("神奈川");
    expect(fallbackPlaceQuery("京都の旅", "")).toBe("京都");
  });

  it("どちらも無ければ空", () => {
    expect(fallbackPlaceQuery("", "")).toBe("");
  });
});

describe("parsePlacesResponse", () => {
  it("最初の場所の最初の写真と撮影者を取り出す", () => {
    expect(
      parsePlacesResponse({
        places: [
          {
            displayName: { text: "鎌倉" },
            photos: [
              { name: "places/ChIJ_kamakura/photos/AWU5eF_1", authorAttributions: [{ displayName: "山田太郎" }] },
            ],
          },
        ],
      }),
    ).toEqual({ photo: "places/ChIJ_kamakura/photos/AWU5eF_1", attribution: "山田太郎" });
  });

  it("写真を持たない場所は飛ばして次を見る", () => {
    expect(
      parsePlacesResponse({
        places: [
          { displayName: { text: "写真なし" } },
          { photos: [{ name: "places/ChIJ_next/photos/AWU5eF_2" }] },
        ],
      }),
    ).toEqual({ photo: "places/ChIJ_next/photos/AWU5eF_2", attribution: undefined });
  });

  it("1枚も無ければ null（同梱の写真のままにする）", () => {
    expect(parsePlacesResponse({ places: [] })).toBeNull();
    expect(parsePlacesResponse(null)).toBeNull();
  });
});

describe("Netlify版とVercel版が食い違っていないこと", () => {
  it("同じ入力に同じ答えを返す", () => {
    expect(VERCEL_SYSTEM_PROMPT).toBe(SYSTEM_PROMPT);
    expect(vercelIsPlacePhotoName("places/a_b-1/photos/c-2")).toBe(isPlacePhotoName("places/a_b-1/photos/c-2"));
    expect(vercelIsPlacePhotoName("../etc/passwd")).toBe(isPlacePhotoName("../etc/passwd"));
    expect(vercelParsePlaceQueryResponse('{"query":"鎌倉"}')).toBe(parsePlaceQueryResponse('{"query":"鎌倉"}'));
    expect(vercelFallbackPlaceQuery("神奈川旅行", "")).toBe(fallbackPlaceQuery("神奈川旅行", ""));
    const sample = { places: [{ photos: [{ name: "places/x/photos/y", authorAttributions: [{ displayName: "A" }] }] }] };
    expect(vercelParsePlacesResponse(sample)).toEqual(parsePlacesResponse(sample));
  });
});
