import { describe, expect, it } from "vitest";
import { isHomePlace, resolveHomeStops } from "./homePlace";

describe("isHomePlace", () => {
  it("家そのものを指す書き方を拾う", () => {
    for (const place of ["自宅", "家", " 自宅 ", "自宅から", "家へ", "帰宅", "自宅（出発）", "自宅(到着)", "おうち", "我が家"]) {
      expect(isHomePlace(place), place).toBe(true);
    }
  });

  it("後ろに名前が続くお店などは拾わない", () => {
    for (const place of ["お家サロン 縁 yukari", "家具の店", "自宅近くのカフェ", "実家", "高知城", ""]) {
      expect(isHomePlace(place), place).toBe(false);
    }
  });
});

describe("resolveHomeStops", () => {
  it("住所があれば「自宅」を住所に置き換える", () => {
    expect(resolveHomeStops(["自宅", "高知城", "帰宅"], "東京都千代田区1-1")).toEqual({
      stops: ["東京都千代田区1-1", "高知城", "東京都千代田区1-1"],
      homeSkipped: false,
    });
  });

  it("住所が無ければ経路から外し、外したことを返す", () => {
    expect(resolveHomeStops(["自宅", "高知城", "桂浜"], "")).toEqual({ stops: ["高知城", "桂浜"], homeSkipped: true });
    expect(resolveHomeStops(["高知城", "桂浜"], undefined)).toEqual({ stops: ["高知城", "桂浜"], homeSkipped: false });
  });

  it("外したり置き換えたりして同じ場所が続いたら1つにまとめる", () => {
    expect(resolveHomeStops(["高知城", "自宅", "高知城"], "")).toEqual({ stops: ["高知城"], homeSkipped: true });
    expect(resolveHomeStops(["自宅", "家から"], "東京都千代田区1-1").stops).toEqual(["東京都千代田区1-1"]);
  });
});
