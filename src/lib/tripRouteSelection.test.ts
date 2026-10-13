// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { readHiddenPlaceIds, toggleHiddenPlace, writeHiddenPlaceIds } from "./tripRouteSelection";

beforeEach(() => localStorage.clear());

describe("ルートの「地図に出す場所」の記録", () => {
  it("何も覚えていなければ、全部出す(外した場所は無い)", () => {
    expect(readHiddenPlaceIds("t1")).toEqual([]);
  });

  it("旅行ごとに別々に覚える", () => {
    writeHiddenPlaceIds("t1", ["p1"], ["p1", "p2"]);
    writeHiddenPlaceIds("t2", ["q1"], ["q1"]);
    expect(readHiddenPlaceIds("t1")).toEqual(["p1"]);
    expect(readHiddenPlaceIds("t2")).toEqual(["q1"]);
  });

  it("もうルートに無い場所・重なりは落とす。全部戻したら記録ごと消す", () => {
    expect(writeHiddenPlaceIds("t1", ["p1", "p1", "gone"], ["p1", "p2"])).toEqual(["p1"]);
    expect(readHiddenPlaceIds("t1")).toEqual(["p1"]);
    expect(writeHiddenPlaceIds("t1", [], ["p1", "p2"])).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it("壊れた記録は、何も外していない扱い", () => {
    localStorage.setItem("lifeHubRouteHidden:t1", "{壊れた");
    expect(readHiddenPlaceIds("t1")).toEqual([]);
    localStorage.setItem("lifeHubRouteHidden:t1", JSON.stringify(["a", 3, null, "b"]));
    expect(readHiddenPlaceIds("t1")).toEqual(["a", "b"]);
  });

  it("toggleHiddenPlace: 外す・戻す", () => {
    expect(toggleHiddenPlace([], "p1", false)).toEqual(["p1"]);
    expect(toggleHiddenPlace(["p1"], "p1", false)).toEqual(["p1"]);
    expect(toggleHiddenPlace(["p1", "p2"], "p1", true)).toEqual(["p2"]);
  });
});
