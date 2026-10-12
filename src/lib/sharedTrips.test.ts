// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { ownerIdForPush, planSharedTrips, readSeenSharedTrips, readSharedOwners, subscribeSharedOwners, writeSharedOwners } from "./sharedTrips";

describe("planSharedTrips", () => {
  it("まだ取り込んでいない共有の旅行は取り込み、もう共有されていない取り込み済みの旅行は片付ける", () => {
    const memberships = new Map([["a", "owner"], ["b", "owner"]]);
    expect(planSharedTrips(memberships, new Set(["b", "c"]))).toEqual({ backfill: ["a"], release: ["c"] });
    expect(planSharedTrips(new Map(), new Set())).toEqual({ backfill: [], release: [] });
  });
});

describe("ownerIdForPush", () => {
  const shared = new Map([["trip-1", "owner-1"]]);
  it("共有された旅行の、旅行本体・日程・費用・持ち物・ルートは、持ち主の名前", () => {
    expect(ownerIdForPush(shared, "trips", { id: "trip-1" })).toBe("owner-1");
    for (const table of ["trip_schedule", "trip_expenses", "trip_packing_items", "trip_route_places"]) {
      expect(ownerIdForPush(shared, table, { id: "x", tripId: "trip-1" })).toBe("owner-1");
    }
    expect(ownerIdForPush(shared, "trip_expense_currencies", { id: "x" }, "trip-1")).toBe("owner-1");
  });

  it("共有されていない旅行・旅行に紐づかない表・旅行が分からない行は null(自分の名前)", () => {
    expect(ownerIdForPush(shared, "trips", { id: "trip-2" })).toBeNull();
    expect(ownerIdForPush(shared, "trip_schedule", { id: "x", tripId: "trip-2" })).toBeNull();
    expect(ownerIdForPush(shared, "trip_schedule", { id: "x" })).toBeNull();
    expect(ownerIdForPush(shared, "trip_expense_currencies", { id: "x" })).toBeNull();
    expect(ownerIdForPush(shared, "tasks", { id: "trip-1", tripId: "trip-1" })).toBeNull();
    expect(ownerIdForPush(new Map(), "trips", { id: "trip-1" })).toBeNull();
  });
});

describe("共有された旅行の記録", () => {
  beforeEach(() => localStorage.clear());

  it("書いた内容を読み戻せる。壊れた記録は空として扱う", () => {
    writeSharedOwners(new Map([["t", "o"]]));
    expect(readSharedOwners()).toEqual(new Map([["t", "o"]]));
    localStorage.setItem("lifeHubLastSynced:__shared_trip_owners", "{壊れた");
    expect(readSharedOwners().size).toBe(0);
    localStorage.setItem("lifeHubLastSynced:__shared_trips_seen", JSON.stringify(["a", 3, null]));
    expect([...readSeenSharedTrips()]).toEqual(["a"]);
  });

  it("書くと、画面(購読している側)に知らせる。購読をやめたら知らせない", () => {
    let calls = 0;
    const stop = subscribeSharedOwners(() => (calls += 1));
    writeSharedOwners(new Map([["t", "o"]]));
    expect(calls).toBe(1);
    stop();
    writeSharedOwners(new Map());
    expect(calls).toBe(1);
  });
});
