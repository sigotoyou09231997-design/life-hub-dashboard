import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripScheduleItem } from "../types";
import {
  buildDayRoute,
  buildSegmentLinks,
  dayRouteStops,
  legKey,
  stopKeys,
  maxWaypointsForDevice,
  MAX_WAYPOINTS_DESKTOP,
  MAX_WAYPOINTS_MOBILE,
} from "./tripDayRoute";

const DAY = "2026-12-28";

function item(location: string | undefined, startTime: string | undefined, overrides: Partial<TripScheduleItem> = {}): TripScheduleItem {
  return {
    id: `${location}-${startTime}`,
    tripId: "t1",
    date: DAY,
    title: location ?? "(場所なし)",
    location,
    startTime,
    type: "sightseeing",
    createdAt: 1,
    ...overrides,
  };
}

function params(url: string) {
  return new URL(url).searchParams;
}

/** 地点 A, B, C … を時刻順に並べた1日ぶんの日程。 */
function dayOf(count: number): TripScheduleItem[] {
  return Array.from({ length: count }, (_, i) =>
    item(String.fromCharCode(65 + i), `${String(8 + i).padStart(2, "0")}:00`),
  );
}

describe("dayRouteStops", () => {
  it("lists the day's places in time order", () => {
    const stops = dayRouteStops([item("桂浜", "14:50"), item("うだつの町並み", "07:45"), item("高知城", "17:10")], DAY);
    expect(stops).toEqual(["うだつの町並み", "桂浜", "高知城"]);
  });

  it("merges consecutive repeats (leave hotel → drive → arrive) into one stop", () => {
    const stops = dayRouteStops(
      [item("ホテル", "07:00"), item("ホテル", "07:00", { id: "x", createdAt: 2 }), item("うだつ", "07:45"), item("うだつ", "08:35"), item("ホテル", "17:00")],
      DAY,
    );
    expect(stops).toEqual(["ホテル", "うだつ", "ホテル"]);
  });

  it("treats a place written with different case or surrounding spaces as the same", () => {
    expect(dayRouteStops([item("GOKAN KOTOHIRA", "09:00"), item(" gokan kotohira ", "10:00")], DAY)).toEqual(["GOKAN KOTOHIRA"]);
  });

  it("skips items without a place and items on other days", () => {
    const stops = dayRouteStops(
      [item("A", "09:00"), item(undefined, "10:00"), item("   ", "11:00"), item("B", "12:00", { date: "2026-12-29" })],
      DAY,
    );
    expect(stops).toEqual(["A"]);
  });

  it("uses a multi-day stay only on its first day", () => {
    const stay = item("宿", "16:00", { date: "2026-12-27", endDate: "2026-12-29" });
    expect(dayRouteStops([stay], "2026-12-28")).toEqual([]);
    expect(dayRouteStops([stay], "2026-12-27")).toEqual(["宿"]);
  });
});

describe("buildDayRoute", () => {
  it("opens one Google Maps route from the first place to the last, through the rest", () => {
    const route = buildDayRoute(dayOf(4), DAY, "driving", 9);
    expect(route.links).toHaveLength(1);
    const p = params(route.links[0].url);
    expect(p.get("origin")).toBe("A");
    expect(p.get("destination")).toBe("D");
    expect(p.get("waypoints")).toBe("B|C");
    expect(p.get("travelmode")).toBe("driving");
    expect(route.links[0]).toMatchObject({ from: "A", to: "D", count: 4 });
  });

  it("passes the chosen travel mode", () => {
    expect(params(buildDayRoute(dayOf(3), DAY, "walking", 9).links[0].url).get("travelmode")).toBe("walking");
  });

  it("opens a place search when the day has just one place", () => {
    const route = buildDayRoute(dayOf(1), DAY, "driving", 9);
    expect(route.links).toHaveLength(1);
    expect(route.links[0].url).toContain("/maps/search/");
    expect(params(route.links[0].url).get("query")).toBe("A");
  });

  it("returns no link when the day has no places", () => {
    expect(buildDayRoute([], DAY, "driving", 9)).toEqual({ stops: [], links: [] });
  });

  it("keeps 11 places (origin + 9 stops + destination) in one link on a desktop", () => {
    const route = buildDayRoute(dayOf(11), DAY, "driving", MAX_WAYPOINTS_DESKTOP);
    expect(route.links).toHaveLength(1);
    expect(params(route.links[0].url).get("waypoints")!.split("|")).toHaveLength(9);
  });

  it("splits a longer day, sharing the joint between two links", () => {
    const route = buildDayRoute(dayOf(12), DAY, "driving", MAX_WAYPOINTS_DESKTOP);
    expect(route.links.map((l) => [l.from, l.to, l.count])).toEqual([
      ["A", "K", 11],
      ["K", "L", 2],
    ]);
  });

  it("uses 5 places per link on a phone browser (3 stops allowed)", () => {
    const route = buildDayRoute(dayOf(12), DAY, "driving", MAX_WAYPOINTS_MOBILE);
    expect(route.links.map((l) => [l.from, l.to, l.count])).toEqual([
      ["A", "E", 5],
      ["E", "I", 5],
      ["I", "L", 4],
    ]);
    for (const link of route.links) {
      const waypoints = params(link.url).get("waypoints");
      expect((waypoints ? waypoints.split("|").length : 0) <= MAX_WAYPOINTS_MOBILE).toBe(true);
    }
  });

  it("never ends with a link that has a single place", () => {
    const route = buildDayRoute(dayOf(5), DAY, "driving", MAX_WAYPOINTS_MOBILE);
    expect(route.links).toHaveLength(1);
    expect(route.links[0].count).toBe(5);
  });

  it("covers every place across the links", () => {
    const route = buildDayRoute(dayOf(20), DAY, "driving", MAX_WAYPOINTS_MOBILE);
    const covered = new Set<string>();
    for (const link of route.links) {
      const p = params(link.url);
      covered.add(p.get("origin")!);
      covered.add(p.get("destination")!);
      p.get("waypoints")?.split("|").forEach((w) => covered.add(w));
    }
    expect([...covered].sort()).toEqual(route.stops.slice().sort());
  });
});

describe("maxWaypointsForDevice", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("allows 3 on a phone browser and 9 elsewhere", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148" });
    expect(maxWaypointsForDevice()).toBe(MAX_WAYPOINTS_MOBILE);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120" });
    expect(maxWaypointsForDevice()).toBe(MAX_WAYPOINTS_DESKTOP);
  });
});

describe("buildSegmentLinks", () => {
  const stops = ["A", "B", "C", "D", "E"];

  it("keeps one link when every leg uses the same mode", () => {
    const links = buildSegmentLinks(stops, ["driving", "driving", "driving", "driving"], 9);
    expect(links.map((l) => [l.mode, l.from, l.to, l.count])).toEqual([["driving", "A", "E", 5]]);
  });

  it("splits where the mode changes, sharing the place where it changes", () => {
    const links = buildSegmentLinks(stops, ["walking", "driving", "driving", "walking"], 9);
    expect(links.map((l) => [l.mode, l.from, l.to])).toEqual([
      ["walking", "A", "B"],
      ["driving", "B", "D"],
      ["walking", "D", "E"],
    ]);
    expect(params(links[1].url).get("travelmode")).toBe("driving");
    expect(params(links[1].url).get("waypoints")).toBe("C");
  });

  it("opens train/bus legs one at a time (Google cannot route transit through stops)", () => {
    const links = buildSegmentLinks(stops, ["transit", "transit", "driving", "driving"], 9);
    expect(links.map((l) => [l.mode, l.from, l.to])).toEqual([
      ["transit", "A", "B"],
      ["transit", "B", "C"],
      ["driving", "C", "E"],
    ]);
    for (const link of links.filter((l) => l.mode === "transit")) {
      expect(params(link.url).get("waypoints")).toBeNull();
      expect(params(link.url).get("travelmode")).toBe("transit");
    }
  });

  it("still splits a long same-mode stretch by the stop limit", () => {
    const many = Array.from({ length: 7 }, (_, i) => `P${i}`);
    const links = buildSegmentLinks(many, Array(6).fill("driving"), MAX_WAYPOINTS_MOBILE);
    expect(links.map((l) => [l.from, l.to, l.count])).toEqual([
      ["P0", "P4", 5],
      ["P4", "P6", 3],
    ]);
  });

  it("handles a single leg and a single place", () => {
    expect(buildSegmentLinks(["A", "B"], ["walking"], 9).map((l) => [l.mode, l.from, l.to])).toEqual([["walking", "A", "B"]]);
    expect(buildSegmentLinks(["A"], [], 9)[0].url).toContain("/maps/search/");
    expect(buildSegmentLinks([], [], 9)).toEqual([]);
  });
});

describe("legKey / stopKeys", () => {
  it("names a leg by the day and both ends, ignoring case and spaces", () => {
    expect(legKey(DAY, " 桂浜 ", "Kochi")).toBe(legKey(DAY, "桂浜", "kochi"));
    expect(legKey(DAY, "A", "B")).not.toBe(legKey(DAY, "B", "A"));
  });

  it("tells apart the same place visited twice in a day", () => {
    expect(stopKeys(DAY, ["桂浜", "海津見神社", "桂浜"])).toEqual([`${DAY}|桂浜|0`, `${DAY}|海津見神社|0`, `${DAY}|桂浜|1`]);
  });
});
