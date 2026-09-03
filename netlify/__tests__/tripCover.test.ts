import { describe, expect, it } from "vitest";
import {
  SYSTEM_PROMPT,
  describePlacesShortfall,
  fallbackPlaceQuery,
  firstPlaceId,
  parsePlaceDetailsResponse,
  isPlacePhotoName,
  parsePlaceQueryResponse,
  parsePlacesResponse,
} from "../functions/tripCover";
import {
  SYSTEM_PROMPT as VERCEL_SYSTEM_PROMPT,
  describePlacesShortfall as vercelDescribePlacesShortfall,
  fallbackPlaceQuery as vercelFallbackPlaceQuery,
  firstPlaceId as vercelFirstPlaceId,
  parsePlaceDetailsResponse as vercelParsePlaceDetailsResponse,
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
    expect(vercelDescribePlacesShortfall({ places: [] })).toBe(describePlacesShortfall({ places: [] }));
    expect(vercelFirstPlaceId({ places: [{ id: "ChIJabc" }] })).toBe(firstPlaceId({ places: [{ id: "ChIJabc" }] }));
    const details = { photos: [{ name: "places/x/photos/y" }] };
    expect(vercelParsePlaceDetailsResponse(details)).toEqual(parsePlaceDetailsResponse(details));
  });
});

describe("describePlacesShortfall", () => {
  // Google は「0件」も「写真の欄が空」も同じ 200 + cover:null で返してくる。
  // 打ち手が違う（検索語を変える／FieldMaskや課金を疑う）ので、区別できないと詰む。
  it("1件も返ってこなかった時", () => {
    expect(describePlacesShortfall({ places: [] })).toContain("0件");
    expect(describePlacesShortfall(null)).toContain("0件");
  });

  it("場所は返ってきたが写真が付いていない時", () => {
    const message = describePlacesShortfall({ places: [{ displayName: { text: "鎌倉" } }, { photos: [] }] });
    expect(message).toContain("2件");
    expect(message).toContain("写真が付いていません");
    // FieldMask が効いていないのか本当に写真が無いのかを分けるため、欄の名前まで見せる。
    expect(message).toContain("displayName");
  });

  it("写真はあるが識別子が想定外だった時は、その中身まで見せる", () => {
    const message = describePlacesShortfall({ places: [{ photos: [{ name: "places/x/photos/だめな名前" }] }] });
    expect(message).toContain("識別子が想定外");
    expect(message).toContain("places/x/photos/");
  });
});

describe("Text Search が写真を返さなかった時の取り直し", () => {
  // 2026-09-04 に本番で見た形。東京タワーでも id・名前・種別だけ返って写真が落ちた。
  const textSearchAnswer = {
    places: [
      {
        id: "ChIJCewJkL2LGGAR3Qmk0vCTGkg",
        displayName: { text: "東京タワー", languageCode: "ja" },
      },
    ],
  };

  it("名指しで取り直せるよう、場所の id を拾える", () => {
    expect(firstPlaceId(textSearchAnswer)).toBe("ChIJCewJkL2LGGAR3Qmk0vCTGkg");
  });

  it("id が無い・URLに埋められない形なら拾わない", () => {
    expect(firstPlaceId({ places: [{ displayName: { text: "東京タワー" } }] })).toBeNull();
    expect(firstPlaceId({ places: [{ id: "../../secret" }] })).toBeNull();
    expect(firstPlaceId(null)).toBeNull();
  });

  it("Place Details の答え（places で包まれていない）からも写真を選べる", () => {
    const cover = parsePlaceDetailsResponse({
      photos: [{ name: "places/ChIJabc/photos/AeJbb3c-1", authorAttributions: [{ displayName: "撮影者" }] }],
    });
    expect(cover).toEqual({ photo: "places/ChIJabc/photos/AeJbb3c-1", attribution: "撮影者" });
  });

  it("Place Details にも写真が無ければ null", () => {
    expect(parsePlaceDetailsResponse({})).toBeNull();
  });
});
