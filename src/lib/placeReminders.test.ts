import { describe, expect, it } from "vitest";
import type { PlaceReminder } from "../types";
import {
  checkPlaceReminders,
  describePlaceReminder,
  distanceMeters,
  isInsideRadius,
  radiusLabel,
  RENOTIFY_COOLDOWN_MS,
  SETTLE_AFTER_CREATE_MS,
} from "./placeReminders";

const TOKYO_STATION = { latitude: 35.681236, longitude: 139.767125 };
/** 東京駅から約740m(日本橋あたり)。半径200mの外・2kmの中に入る位置として使う。 */
const NIHONBASHI = { latitude: 35.6841, longitude: 139.7745 };

const NOW = new Date("2026-09-04T12:00:00Z").getTime();

function reminder(overrides: Partial<PlaceReminder> = {}): PlaceReminder {
  return {
    id: "r1",
    ownerType: "note",
    ownerId: "n1",
    label: "東京駅",
    latitude: TOKYO_STATION.latitude,
    longitude: TOKYO_STATION.longitude,
    radiusMeters: 200,
    trigger: "enter",
    // 既定では「作ってから十分たっている」— 落ち着き待ちを絡めないため。
    createdAt: NOW - 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

describe("distanceMeters", () => {
  it("同じ地点は0m", () => {
    expect(distanceMeters(TOKYO_STATION, TOKYO_STATION)).toBe(0);
  });

  it("東京駅から日本橋あたりまでは700m台", () => {
    const d = distanceMeters(TOKYO_STATION, NIHONBASHI);
    expect(d).toBeGreaterThan(700);
    expect(d).toBeLessThan(800);
  });

  it("緯度1分はおよそ1.85km", () => {
    const d = distanceMeters({ latitude: 35, longitude: 139 }, { latitude: 35 + 1 / 60, longitude: 139 });
    expect(d).toBeGreaterThan(1800);
    expect(d).toBeLessThan(1900);
  });
});

describe("isInsideRadius", () => {
  it("半径の中なら true", () => {
    expect(isInsideRadius(reminder({ radiusMeters: 2000 }), NIHONBASHI)).toBe(true);
  });

  it("半径の外なら false", () => {
    expect(isInsideRadius(reminder({ radiusMeters: 200 }), NIHONBASHI)).toBe(false);
  });
});

describe("checkPlaceReminders", () => {
  it("外から中に入ったら鳴る(着いたら)", () => {
    const [check] = checkPlaceReminders([reminder({ inside: false })], TOKYO_STATION, NOW);
    expect(check).toMatchObject({ inside: true, fired: true });
  });

  it("中に留まっている間は鳴り続けない", () => {
    const [check] = checkPlaceReminders([reminder({ inside: true })], TOKYO_STATION, NOW);
    expect(check).toMatchObject({ inside: true, fired: false });
  });

  it("中から外に出ても、「着いたら」なら鳴らない", () => {
    const [check] = checkPlaceReminders([reminder({ inside: true })], NIHONBASHI, NOW);
    expect(check).toMatchObject({ inside: false, fired: false });
  });

  it("「離れたら」は、中から外に出たときに鳴る", () => {
    const [check] = checkPlaceReminders([reminder({ trigger: "leave", inside: true })], NIHONBASHI, NOW);
    expect(check).toMatchObject({ inside: false, fired: true });
  });

  it("「離れたら」は、外から中に入っても鳴らない", () => {
    const [check] = checkPlaceReminders([reminder({ trigger: "leave", inside: false })], TOKYO_STATION, NOW);
    expect(check.fired).toBe(false);
  });

  it("一度鳴らしたら、30分の間は鳴らし直さない(GPSの揺れで往復するため)", () => {
    const justNotified = reminder({ inside: false, lastNotifiedAt: NOW - RENOTIFY_COOLDOWN_MS + 1000 });
    expect(checkPlaceReminders([justNotified], TOKYO_STATION, NOW)[0].fired).toBe(false);

    const longAgo = reminder({ inside: false, lastNotifiedAt: NOW - RENOTIFY_COOLDOWN_MS - 1000 });
    expect(checkPlaceReminders([longAgo], TOKYO_STATION, NOW)[0].fired).toBe(true);
  });

  it("前回の記録が無くても、作ってから十分たっていれば到着として鳴る", () => {
    // 家で設定して、閉じたまま移動し、現地で初めて開いた場合。
    const [check] = checkPlaceReminders([reminder({ inside: undefined })], TOKYO_STATION, NOW);
    expect(check.fired).toBe(true);
  });

  it("その場で設定した直後は鳴らない", () => {
    const fresh = reminder({ inside: undefined, createdAt: NOW - SETTLE_AFTER_CREATE_MS + 1000 });
    expect(checkPlaceReminders([fresh], TOKYO_STATION, NOW)[0].fired).toBe(false);
  });

  it("前回の記録が無く、範囲の外にいるだけなら鳴らさず、内外だけ覚える", () => {
    const [check] = checkPlaceReminders([reminder({ inside: undefined })], NIHONBASHI, NOW);
    expect(check).toMatchObject({ inside: false, fired: false });
  });

  it("複数のリマインドを1回の現在地でまとめて見る", () => {
    const checks = checkPlaceReminders(
      [
        reminder({ id: "a", inside: false }),
        reminder({ id: "b", inside: false, radiusMeters: 2000 }),
        reminder({ id: "c", inside: false, latitude: 34.7, longitude: 135.5 }),
      ],
      TOKYO_STATION,
      NOW,
    );
    expect(checks.map((c) => c.fired)).toEqual([true, true, false]);
  });
});

describe("describePlaceReminder / radiusLabel", () => {
  it("設定を1行の言葉にする", () => {
    expect(describePlaceReminder({ label: "東京駅", trigger: "enter", radiusMeters: 200 })).toBe(
      "東京駅(半径200m)に着いたら",
    );
    expect(describePlaceReminder({ label: "会社", trigger: "leave", radiusMeters: 1000 })).toBe(
      "会社(半径1km)に離れたら",
    );
  });

  it("1000m以上はkmで書く", () => {
    expect(radiusLabel(500)).toBe("500m");
    expect(radiusLabel(1000)).toBe("1km");
  });
});
