/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { destinationQuery, geocodePlace, parseGeocodeResults, placeSubtitle, searchPlaces } from "./geocoding";

const GEOCODE_OK = {
  results: [{ name: "京都市", latitude: 35.0116, longitude: 135.7681, country: "日本", admin1: "京都府" }],
};

function mockFetch(body: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("destinationQuery", () => {
  it("そのまま地名なら、そのまま渡す", () => {
    expect(destinationQuery("京都")).toBe("京都");
  });

  it("複数の行き先は、先頭だけを渡す(検索は1語しか受け取れないため)", () => {
    expect(destinationQuery("京都・大阪")).toBe("京都");
    expect(destinationQuery("京都、奈良")).toBe("京都");
    expect(destinationQuery("Paris / Lyon")).toBe("Paris");
  });

  it("かっこ書きの注釈は落とす", () => {
    expect(destinationQuery("パリ（フランス）")).toBe("パリ");
    expect(destinationQuery("Hanoi (Vietnam)")).toBe("Hanoi");
  });

  it("空白だけなら空", () => {
    expect(destinationQuery("   ")).toBe("");
  });
});

describe("parseGeocodeResults", () => {
  it("候補の並びに直す", () => {
    expect(parseGeocodeResults(GEOCODE_OK)).toEqual([
      { name: "京都市", latitude: 35.0116, longitude: 135.7681, country: "日本", admin1: "京都府" },
    ]);
  });

  it("見つからなかった応答は空", () => {
    expect(parseGeocodeResults({})).toEqual([]);
    expect(parseGeocodeResults({ results: [] })).toEqual([]);
    expect(parseGeocodeResults(null)).toEqual([]);
  });

  it("緯度経度が数字でない行は落とす", () => {
    const results = parseGeocodeResults({
      results: [{ name: "こわれた行", latitude: "35" }, { name: "まともな行", latitude: 1, longitude: 2 }],
    });
    expect(results.map((p) => p.name)).toEqual(["まともな行"]);
  });
});

describe("geocodePlace", () => {
  it("いちど引いた地名は端末に覚えて、二度と問い合わせない", async () => {
    const fetchMock = mockFetch(GEOCODE_OK);
    expect((await geocodePlace("京都"))?.name).toBe("京都市");
    expect((await geocodePlace("京都"))?.name).toBe("京都市");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("見つからなかったことも覚える(引き直しても結果は変わらないため)", async () => {
    const fetchMock = mockFetch({ results: [] });
    expect(await geocodePlace("ここではないどこか")).toBeUndefined();
    expect(await geocodePlace("ここではないどこか")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("覚えた内容は期限を過ぎたら引き直す", async () => {
    const fetchMock = mockFetch(GEOCODE_OK);
    const now = Date.now();
    await geocodePlace("京都", now);
    await geocodePlace("京都", now + 91 * 24 * 60 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("空の行き先は問い合わせない", async () => {
    const fetchMock = mockFetch(GEOCODE_OK);
    expect(await geocodePlace("  ")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("searchPlaces", () => {
  it("打った言葉で候補を引く(控えは取らない)", async () => {
    const fetchMock = mockFetch(GEOCODE_OK);
    expect(await searchPlaces("京都")).toHaveLength(1);
    await searchPlaces("京都");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("空の言葉では問い合わせない", async () => {
    const fetchMock = mockFetch(GEOCODE_OK);
    expect(await searchPlaces("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("失敗しても投げず、空振りにする", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await searchPlaces("京都")).toEqual([]);
  });
});

describe("placeSubtitle", () => {
  it("都道府県と国を並べる", () => {
    expect(placeSubtitle({ name: "京都市", latitude: 0, longitude: 0, admin1: "京都府", country: "日本" })).toBe(
      "京都府・日本",
    );
  });

  it("分かる方だけ出す", () => {
    expect(placeSubtitle({ name: "どこか", latitude: 0, longitude: 0, country: "日本" })).toBe("日本");
    expect(placeSubtitle({ name: "どこか", latitude: 0, longitude: 0 })).toBe("");
  });
});
