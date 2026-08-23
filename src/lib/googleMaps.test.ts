import { describe, expect, it } from "vitest";
import { buildRouteEmbedUrl, buildRouteSearchUrl, buildLegSearchUrl } from "./googleMaps";

describe("buildRouteEmbedUrl", () => {
  it("chains every stop through saddr / daddr+to:", () => {
    const url = buildRouteEmbedUrl(["函館駅", "五稜郭", "元町"]);
    expect(url).toBe(
      "https://maps.google.com/maps?saddr=%E5%87%BD%E9%A4%A8%E9%A7%85&daddr=%E4%BA%94%E7%A8%9C%E9%83%AD+to:%E5%85%83%E7%94%BA&output=embed",
    );
  });

  it("falls back to a single-place map when there is nothing to route between", () => {
    expect(buildRouteEmbedUrl(["五稜郭"])).toBe("https://maps.google.com/maps?q=%E4%BA%94%E7%A8%9C%E9%83%AD&output=embed");
  });

  it("ignores blank stops", () => {
    expect(buildRouteEmbedUrl(["函館駅", "  ", "元町"])).toContain("saddr=%E5%87%BD%E9%A4%A8%E9%A7%85&daddr=%E5%85%83%E7%94%BA");
  });

  it("does not throw on an empty list", () => {
    expect(buildRouteEmbedUrl([])).toContain("output=embed");
  });
});

describe("buildRouteSearchUrl", () => {
  it("puts the middle stops in waypoints", () => {
    const url = buildRouteSearchUrl(["函館駅", "五稜郭", "元町", "函館山"]);
    expect(url).toContain("origin=%E5%87%BD%E9%A4%A8%E9%A7%85");
    expect(url).toContain("destination=%E5%87%BD%E9%A4%A8%E5%B1%B1");
    expect(url).toContain("waypoints=%E4%BA%94%E7%A8%9C%E9%83%AD%7C%E5%85%83%E7%94%BA");
  });

  it("omits waypoints for a two-stop route", () => {
    expect(buildRouteSearchUrl(["函館駅", "元町"])).not.toContain("waypoints");
  });

  it("degrades to a plain place search for one stop", () => {
    expect(buildRouteSearchUrl(["五稜郭"])).toContain("/maps/search/?api=1");
  });
});

describe("buildLegSearchUrl", () => {
  it("routes from one place to the next", () => {
    expect(buildLegSearchUrl("五稜郭", "元町")).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=%E4%BA%94%E7%A8%9C%E9%83%AD&destination=%E5%85%83%E7%94%BA",
    );
  });
});
