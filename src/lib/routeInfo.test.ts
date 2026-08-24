import { describe, expect, it } from "vitest";
import {
  FLIGHT_MIN_DISTANCE_METERS,
  estimateFuelCostYen,
  formatDistance,
  formatDuration,
  formatMoney,
  normalizeQuery,
  shouldOfferFlight,
} from "./routeInfo";
import { buildFlightSearchUrl } from "./googleMaps";

describe("formatDuration", () => {
  it("1時間未満は分で出す", () => {
    expect(formatDuration(1620)).toBe("27分");
  });

  it("1時間以上は時間と分に分ける", () => {
    expect(formatDuration(3900)).toBe("1時間5分");
    expect(formatDuration(7200)).toBe("2時間");
  });

  it("1分未満でも0分とは書かない", () => {
    expect(formatDuration(20)).toBe("1分");
  });
});

describe("formatDistance", () => {
  it("1km未満はm、10km未満は小数1桁、それ以上は整数", () => {
    expect(formatDistance(850)).toBe("850m");
    expect(formatDistance(2140)).toBe("2.1km");
    expect(formatDistance(23400)).toBe("23km");
  });
});

describe("formatMoney", () => {
  it("円は日本語の表記にする", () => {
    expect(formatMoney({ currency: "JPY", amount: 1320 })).toBe("1,320円");
  });

  it("円以外は通貨コードを添える", () => {
    expect(formatMoney({ currency: "USD", amount: 12 })).toBe("USD 12");
  });
});

describe("estimateFuelCostYen", () => {
  it("距離からガソリン代の概算を出す(15km/L・175円/L)", () => {
    // 30km ÷ 15km/L = 2L → 2L × 175円 = 350円
    expect(estimateFuelCostYen(30_000)).toBe(350);
  });
});

describe("normalizeQuery", () => {
  it("現在地の座標は約100m単位に丸める(同じ場所で問い合わせが増えないように)", () => {
    expect(normalizeQuery("35.681236,139.767125")).toBe("35.681,139.767");
    expect(normalizeQuery("35.681240,139.767130")).toBe("35.681,139.767");
  });

  it("住所は前後の空白を落とすだけ", () => {
    expect(normalizeQuery(" 鎌倉駅 ")).toBe("鎌倉駅");
  });
});

describe("shouldOfferFlight", () => {
  it("短い区間では出さない", () => {
    expect(shouldOfferFlight(2_100)).toBe(false);
    expect(shouldOfferFlight(FLIGHT_MIN_DISTANCE_METERS - 1)).toBe(false);
  });

  it("長い区間では出す", () => {
    expect(shouldOfferFlight(FLIGHT_MIN_DISTANCE_METERS)).toBe(true);
    expect(shouldOfferFlight(620_000)).toBe(true);
  });

  it("距離が分からない時(APIキー未設定など)は出す", () => {
    expect(shouldOfferFlight(undefined)).toBe(true);
  });
});

describe("buildFlightSearchUrl", () => {
  it("地名どうしなら出発地と行き先の両方を渡す", () => {
    const url = buildFlightSearchUrl("岡山駅前", "神奈川県鎌倉市");
    expect(url).toContain("google.com/travel/flights");
    expect(decodeURIComponent(url)).toContain("Flights from 岡山駅前 to 神奈川県鎌倉市");
  });

  it("出発地が現在地(座標)なら出発地は渡さない(Googleフライト側が現在地から埋める)", () => {
    const url = buildFlightSearchUrl("34.665,133.918", "神奈川県鎌倉市");
    expect(decodeURIComponent(url)).toContain("Flights to 神奈川県鎌倉市");
    expect(decodeURIComponent(url)).not.toContain("34.665");
  });
});
