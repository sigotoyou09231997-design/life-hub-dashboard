import { describe, expect, it } from "vitest";
import { describeWalk, findViaStation } from "./tripLegVia";

const leg = {
  origin: "35.681236,139.767125",
  originLabel: "現在地",
  destination: "6-10-1 Sakanoshita, 鎌倉市, 神奈川県 248-0021, 日本",
  destinationLabel: "宿泊先",
};

describe("区間を駅で分ける", () => {
  it("行き先の最寄り駅を経由地にする", () => {
    const station = findViaStation(
      { configured: true, station: { name: "長谷駅" }, walk: { durationSeconds: 420, distanceMeters: 600 } },
      leg,
    );

    expect(station?.name).toBe("長谷駅");
  });

  it("駅が取れない時は分けない(これまでどおり1本の経路にする)", () => {
    expect(findViaStation({ configured: false }, leg)).toBeUndefined();
    expect(findViaStation(null, leg)).toBeUndefined();
  });

  it("行き先が駅のすぐそばなら分けない", () => {
    const station = findViaStation(
      { configured: true, station: { name: "長谷駅" }, walk: { durationSeconds: 60, distanceMeters: 80 } },
      leg,
    );

    expect(station).toBeUndefined();
  });

  it("その駅から出発する区間・その駅へ行く区間は分けない", () => {
    const toStation = findViaStation(
      { configured: true, station: { name: "長谷駅" }, walk: { distanceMeters: 900 } },
      { ...leg, destinationLabel: "長谷駅" },
    );
    const fromStation = findViaStation(
      { configured: true, station: { name: "長谷駅" }, walk: { distanceMeters: 900 } },
      { ...leg, originLabel: "長谷駅", origin: "長谷駅の住所" },
    );

    expect(toStation).toBeUndefined();
    expect(fromStation).toBeUndefined();
  });

  it("地名が同じだけの住所(鎌倉市と鎌倉駅)では分けるのをやめない", () => {
    const station = findViaStation(
      { configured: true, station: { name: "鎌倉駅" }, walk: { distanceMeters: 1500 } },
      leg,
    );

    expect(station?.name).toBe("鎌倉駅");
  });
});

describe("駅からの徒歩の書き方", () => {
  it("時間と距離を並べる", () => {
    expect(describeWalk({ durationSeconds: 420, distanceMeters: 600 })).toBe("徒歩7分(600m)");
  });

  it("片方しか無い時はあるほうだけ出す", () => {
    expect(describeWalk({ durationSeconds: 420 })).toBe("徒歩7分");
    expect(describeWalk({ distanceMeters: 600 })).toBe("徒歩600m");
  });

  it("どちらも無ければ何も出さない", () => {
    expect(describeWalk(undefined)).toBe("");
    expect(describeWalk({})).toBe("");
  });
});
