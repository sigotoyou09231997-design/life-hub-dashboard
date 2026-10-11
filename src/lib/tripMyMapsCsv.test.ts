import { describe, expect, it } from "vitest";
import type { Trip, TripScheduleItem } from "../types";
import { buildTripMyMapsCsv, MYMAPS_CSV_HEADER, tripMyMapsFilename } from "./tripMyMapsCsv";

const trip: Trip = {
  id: "t1",
  name: "四国",
  destination: "徳島",
  startDate: "2026-10-12",
  endDate: "2026-10-14",
  status: "planning",
  createdAt: 1,
};

function item(overrides: Partial<TripScheduleItem> = {}): TripScheduleItem {
  return {
    id: "s1",
    tripId: "t1",
    date: "2026-10-12",
    title: "うずしお観潮船",
    location: "鳴門市鳴門町土佐泊浦",
    type: "sightseeing",
    createdAt: 1,
    ...overrides,
  };
}

function lines(csv: string): string[] {
  return csv.split("\r\n");
}

describe("buildTripMyMapsCsv", () => {
  it("starts with the header, location column first", () => {
    const { csv } = buildTripMyMapsCsv(trip, [item()]);
    expect(lines(csv)[0]).toBe(MYMAPS_CSV_HEADER.join(","));
    expect(MYMAPS_CSV_HEADER[0]).toBe("場所");
  });

  it("writes one row per schedule item with day number, time and type label", () => {
    const { csv, placed } = buildTripMyMapsCsv(trip, [
      item({ date: "2026-10-13", startTime: "09:00", endTime: "10:30", memo: "予約済み", type: "meal" }),
    ]);
    expect(placed).toBe(1);
    expect(lines(csv)[1]).toBe("鳴門市鳴門町土佐泊浦,うずしお観潮船,2日目,2026-10-13,,09:00〜10:30,食事,予約済み");
  });

  it("orders by date, then start time, then creation order", () => {
    const { csv } = buildTripMyMapsCsv(trip, [
      item({ id: "c", title: "C", date: "2026-10-13", startTime: "08:00" }),
      item({ id: "b", title: "B", date: "2026-10-12", startTime: "15:00" }),
      item({ id: "a", title: "A", date: "2026-10-12", startTime: "09:00" }),
    ]);
    expect(lines(csv).slice(1).map((l) => l.split(",")[1])).toEqual(["A", "B", "C"]);
  });

  it("leaves items without a location out of the CSV and reports them", () => {
    const withoutPlace = item({ id: "x", title: "新幹線で移動", location: undefined, type: "transport" });
    const blankPlace = item({ id: "y", title: "昼食", location: "  " });
    const { csv, placed, skipped } = buildTripMyMapsCsv(trip, [item(), withoutPlace, blankPlace]);
    expect(placed).toBe(1);
    expect(lines(csv)).toHaveLength(2);
    expect(skipped.map((s) => s.title)).toEqual(["新幹線で移動", "昼食"]);
  });

  it("keeps the end date of a multi-night stay", () => {
    const { csv } = buildTripMyMapsCsv(trip, [
      item({ title: "ホテル", location: "徳島駅", type: "lodging", endDate: "2026-10-14" }),
    ]);
    expect(lines(csv)[1]).toBe("徳島駅,ホテル,1日目,2026-10-12,2026-10-14,,宿泊,");
  });

  it("leaves the day number blank for a date outside the trip", () => {
    const { csv } = buildTripMyMapsCsv(trip, [item({ date: "2026-11-01" })]);
    expect(lines(csv)[1].split(",")[2]).toBe("");
  });

  it("quotes cells that contain commas, quotes or line breaks", () => {
    const { csv } = buildTripMyMapsCsv(trip, [
      item({ location: "徳島県鳴門市, 渦の道", title: '"渦"を見る', memo: "1行目\n2行目" }),
    ]);
    expect(csv).toContain('"徳島県鳴門市, 渦の道","""渦""を見る"');
    expect(csv).toContain('"1行目\n2行目"');
  });

  it("returns only the header when nothing can be placed", () => {
    const { csv, placed, skipped } = buildTripMyMapsCsv(trip, [item({ location: undefined })]);
    expect(placed).toBe(0);
    expect(skipped).toHaveLength(1);
    expect(lines(csv)).toEqual([MYMAPS_CSV_HEADER.join(",")]);
  });
});

describe("tripMyMapsFilename", () => {
  it("names the file after the trip", () => {
    expect(tripMyMapsFilename("四国")).toBe("四国-マイマップ用.csv");
  });

  it("drops characters that file systems reject", () => {
    expect(tripMyMapsFilename('夏/旅:行?')).toBe("夏旅行-マイマップ用.csv");
  });

  it("falls back to a generic name when nothing is left", () => {
    expect(tripMyMapsFilename("///")).toBe("旅行-マイマップ用.csv");
  });
});
