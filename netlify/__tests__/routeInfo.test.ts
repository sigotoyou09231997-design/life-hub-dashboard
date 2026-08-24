import { describe, expect, it } from "vitest";
import { parseDuration, parseMoney, parseRoutesResponse, toWaypoint } from "../functions/routeInfo";

describe("toWaypoint", () => {
  it("現在地の「緯度,経度」は座標として渡す", () => {
    expect(toWaypoint("35.681236,139.767125")).toEqual({
      location: { latLng: { latitude: 35.681236, longitude: 139.767125 } },
    });
  });

  it("住所や施設名はそのまま住所として渡す", () => {
    expect(toWaypoint(" 神奈川県鎌倉市雪ノ下2-1-31 ")).toEqual({ address: "神奈川県鎌倉市雪ノ下2-1-31" });
  });
});

describe("parseDuration", () => {
  it("「1234s」を秒に直す", () => {
    expect(parseDuration("1234s")).toBe(1234);
  });

  it("形式が違えば undefined", () => {
    expect(parseDuration(undefined)).toBeUndefined();
    expect(parseDuration("しばらく")).toBeUndefined();
  });
});

describe("parseMoney", () => {
  it("units(文字列)とnanosから金額にする", () => {
    expect(parseMoney({ currencyCode: "JPY", units: "320", nanos: 0 })).toEqual({ currency: "JPY", amount: 320 });
  });

  it("通貨が無ければ undefined", () => {
    expect(parseMoney({ units: "320" })).toBeUndefined();
    expect(parseMoney(null)).toBeUndefined();
  });
});

describe("parseRoutesResponse", () => {
  it("所要時間・距離・運賃を取り出す", () => {
    const result = parseRoutesResponse({
      routes: [
        {
          duration: "1620s",
          distanceMeters: 5400,
          travelAdvisory: { transitFare: { currencyCode: "JPY", units: "320" } },
        },
      ],
    });
    expect(result).toEqual({ durationSeconds: 1620, distanceMeters: 5400, fare: { currency: "JPY", amount: 320 } });
  });

  it("運賃が返らない経路でも時間と距離は返す", () => {
    const result = parseRoutesResponse({ routes: [{ duration: "600s", distanceMeters: 2100 }] });
    expect(result).toEqual({ durationSeconds: 600, distanceMeters: 2100, fare: undefined });
  });

  it("経路が1件も無ければ「その手段では行けない」扱いにする", () => {
    expect(parseRoutesResponse({ routes: [] })).toEqual({ unavailable: true });
    expect(parseRoutesResponse({})).toEqual({ unavailable: true });
  });
});
