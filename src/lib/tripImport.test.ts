import { describe, expect, it } from "vitest";
import type { Trip } from "../types";
import { isOutsideTrip, pickDefaultTripId, sortTripsForPicker, toImportRows } from "./tripImport";

const trip = (id: string, startDate: string, endDate: string): Trip => ({
  id,
  name: id,
  destination: "どこか",
  startDate,
  endDate,
  status: "planning",
  createdAt: 0,
});

const item = (date: string) => ({ date, title: "移動", type: "transport" as const });

describe("pickDefaultTripId", () => {
  it("読み取った日付を含む旅行を選ぶ", () => {
    const trips = [trip("a", "2026-07-01", "2026-07-03"), trip("b", "2026-09-11", "2026-09-15")];
    expect(pickDefaultTripId(trips, [item("2026-09-12")])).toBe("b");
  });

  it("含む旅行が無ければ、いちばん日付が近い旅行を選ぶ", () => {
    const trips = [trip("a", "2026-01-01", "2026-01-03"), trip("b", "2026-09-20", "2026-09-22")];
    expect(pickDefaultTripId(trips, [item("2026-09-12")])).toBe("b");
  });

  it("旅行が1つも無ければ選ばない", () => {
    expect(pickDefaultTripId([], [item("2026-09-12")])).toBeUndefined();
  });

  it("読み取れた日程が無ければ、とりあえず先頭の旅行", () => {
    const trips = [trip("a", "2026-07-01", "2026-07-03")];
    expect(pickDefaultTripId(trips, [])).toBe("a");
  });
});

describe("isOutsideTrip", () => {
  it("旅行の期間から外れていれば印を出す", () => {
    // 保存はできるが日付タブに出てこないので、気付けるようにする。
    expect(isOutsideTrip(trip("a", "2026-09-11", "2026-09-15"), "2026-09-20")).toBe(true);
    expect(isOutsideTrip(trip("a", "2026-09-11", "2026-09-15"), "2026-09-12")).toBe(false);
  });

  it("旅行が選ばれていなければ印は出さない", () => {
    expect(isOutsideTrip(undefined, "2026-09-20")).toBe(false);
  });
});

describe("toImportRows", () => {
  it("読み取った分は最初から入れる扱いにする(外したいものだけ外す)", () => {
    expect(toImportRows([item("2026-09-12")])[0].checked).toBe(true);
  });
});

describe("sortTripsForPicker", () => {
  it("新しい旅行ほど上に並べる", () => {
    // 並べ替えはDexieに任せず必ずここでやる — tripsの索引は id だけで、
    // orderBy("startDate") は例外になり、画面ごと落ちる。
    const trips = [trip("a", "2026-01-01", "2026-01-03"), trip("b", "2026-09-11", "2026-09-15")];
    expect(sortTripsForPicker(trips).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("渡された配列は書き換えない", () => {
    const trips = [trip("a", "2026-01-01", "2026-01-03"), trip("b", "2026-09-11", "2026-09-15")];
    sortTripsForPicker(trips);
    expect(trips.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
