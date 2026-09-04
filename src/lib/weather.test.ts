/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeWeather,
  destinationQuery,
  fetchTripWeather,
  forecastForDate,
  forecastHorizon,
  geocodePlace,
  parseForecastResponse,
  parseGeocodeResponse,
  resetWeatherCache,
} from "./weather";

const GEOCODE_OK = {
  results: [{ name: "京都市", latitude: 35.0116, longitude: 135.7681, country: "日本" }],
};

const FORECAST_OK = {
  daily: {
    time: ["2026-09-10", "2026-09-11"],
    weather_code: [3, 61],
    temperature_2m_max: [28.4, 24.9],
    temperature_2m_min: [21.2, 19.6],
    precipitation_probability_max: [10, 80],
  },
};

/** URLの中身で応答を出し分ける(地名検索と予報を1本のモックでまかなう)。 */
function mockFetch(map: { geocode?: unknown; forecast?: unknown }) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.includes("geocoding-api") ? map.geocode : map.forecast;
    return { ok: true, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  resetWeatherCache();
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

describe("describeWeather", () => {
  it("天気コードを日本語とアイコンに直す", () => {
    expect(describeWeather(0)).toEqual({ label: "快晴", icon: "sun" });
    expect(describeWeather(65)).toEqual({ label: "強い雨", icon: "rain" });
    expect(describeWeather(95)).toEqual({ label: "雷雨", icon: "thunder" });
  });

  it("知らないコード・欠けている場合は既定に寄せる", () => {
    expect(describeWeather(1234).label).toBe("—");
    expect(describeWeather(undefined).label).toBe("—");
  });
});

describe("parseGeocodeResponse", () => {
  it("先頭の1件を取る", () => {
    expect(parseGeocodeResponse(GEOCODE_OK)).toEqual({
      name: "京都市",
      latitude: 35.0116,
      longitude: 135.7681,
      country: "日本",
    });
  });

  it("見つからなかった応答は undefined", () => {
    expect(parseGeocodeResponse({})).toBeUndefined();
    expect(parseGeocodeResponse({ results: [] })).toBeUndefined();
    expect(parseGeocodeResponse(null)).toBeUndefined();
  });

  it("緯度経度が数字でなければ採らない", () => {
    expect(parseGeocodeResponse({ results: [{ name: "どこか", latitude: "35" }] })).toBeUndefined();
  });
});

describe("parseForecastResponse", () => {
  it("列ごとの配列を1日1件に組み直し、気温は整数に丸める", () => {
    expect(parseForecastResponse(FORECAST_OK)).toEqual([
      { date: "2026-09-10", weatherCode: 3, tempMax: 28, tempMin: 21, precipitationChance: 10 },
      { date: "2026-09-11", weatherCode: 61, tempMax: 25, tempMin: 20, precipitationChance: 80 },
    ]);
  });

  it("気温が欠けている日は落とす", () => {
    const days = parseForecastResponse({
      daily: { time: ["2026-09-10", "2026-09-11"], temperature_2m_max: [28, null], temperature_2m_min: [21, 19] },
    });
    expect(days.map((d) => d.date)).toEqual(["2026-09-10"]);
  });

  it("降水確率が無くても他は出す", () => {
    const days = parseForecastResponse({
      daily: { time: ["2026-09-10"], weather_code: [0], temperature_2m_max: [28], temperature_2m_min: [21] },
    });
    expect(days[0].precipitationChance).toBeUndefined();
  });

  it("形が違う応答では空を返す", () => {
    expect(parseForecastResponse({})).toEqual([]);
    expect(parseForecastResponse(null)).toEqual([]);
  });
});

describe("forecastForDate / forecastHorizon", () => {
  const days = parseForecastResponse(FORECAST_OK);

  it("その日の予報を引く", () => {
    expect(forecastForDate(days, "2026-09-11")?.tempMax).toBe(25);
  });

  it("予報の範囲外の日は undefined(16日より先はどのAPIでも出せない)", () => {
    expect(forecastForDate(days, "2026-10-30")).toBeUndefined();
  });

  it("予報が出せる最終日が分かる", () => {
    expect(forecastHorizon(days)).toBe("2026-09-11");
    expect(forecastHorizon([])).toBeUndefined();
  });
});

describe("geocodePlace", () => {
  it("いちど引いた地名は端末に覚えて、二度と問い合わせない", async () => {
    const fetchMock = mockFetch({ geocode: GEOCODE_OK });
    expect((await geocodePlace("京都"))?.name).toBe("京都市");
    expect((await geocodePlace("京都"))?.name).toBe("京都市");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("見つからなかったことも覚える(引き直しても結果は変わらないため)", async () => {
    const fetchMock = mockFetch({ geocode: { results: [] } });
    expect(await geocodePlace("ここではないどこか")).toBeUndefined();
    expect(await geocodePlace("ここではないどこか")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("覚えた内容は期限を過ぎたら引き直す", async () => {
    const fetchMock = mockFetch({ geocode: GEOCODE_OK });
    const now = Date.now();
    await geocodePlace("京都", now);
    await geocodePlace("京都", now + 91 * 24 * 60 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchTripWeather", () => {
  it("行き先の予報を引いて返す", async () => {
    mockFetch({ geocode: GEOCODE_OK, forecast: FORECAST_OK });
    const weather = await fetchTripWeather("京都");
    expect(weather.status).toBe("ok");
    expect(weather.place?.name).toBe("京都市");
    expect(weather.days).toHaveLength(2);
  });

  it("行き先を緯度経度に直せなければ unknown-place(天気の欄ごと畳む)", async () => {
    mockFetch({ geocode: { results: [] } });
    expect(await fetchTripWeather("架空の土地")).toEqual({ status: "unknown-place", days: [] });
  });

  it("行き先が空なら問い合わせない", async () => {
    const fetchMock = mockFetch({ geocode: GEOCODE_OK });
    expect(await fetchTripWeather("  ")).toEqual({ status: "unknown-place", days: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("通信が失敗しても投げず、この欄を畳むだけにする", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await fetchTripWeather("京都")).toEqual({ status: "failed", days: [] });
  });

  it("同じ行き先を並べて引いても、問い合わせは1回にまとめる", async () => {
    const fetchMock = mockFetch({ geocode: GEOCODE_OK, forecast: FORECAST_OK });
    const [a, b] = await Promise.all([fetchTripWeather("京都"), fetchTripWeather("京都")]);
    expect(a).toEqual(b);
    // 地名検索1回・予報1回で、2件ぶんの要求をまかなえている。
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
