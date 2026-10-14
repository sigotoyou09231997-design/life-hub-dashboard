/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { isRouteLinked, setRouteLinked } from "./routeLink";

beforeEach(() => window.localStorage.clear());

describe("日程とルートの連動の入り切り", () => {
  it("印が無ければ連動する(入)。切ると、その旅行だけ切れる。入れ直せる", () => {
    expect(isRouteLinked("t1")).toBe(true);
    setRouteLinked("t1", false);
    expect(isRouteLinked("t1")).toBe(false);
    expect(isRouteLinked("t2")).toBe(true);
    setRouteLinked("t1", true);
    expect(isRouteLinked("t1")).toBe(true);
  });
});
