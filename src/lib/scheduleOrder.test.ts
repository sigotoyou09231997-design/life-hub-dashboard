import { describe, expect, it } from "vitest";
import type { TripScheduleItem } from "../types";
import { canSwapWithinTime, compareScheduleDateTime, compareScheduleTime, swapWithinTime } from "./scheduleOrder";

function item(id: string, startTime: string | undefined, createdAt: number, sortOrder?: number, date = "2026-12-29"): TripScheduleItem {
  return { id, tripId: "t", date, startTime, title: id, type: "other", createdAt, sortOrder };
}

describe("同じ時刻の予定の並び", () => {
  it("時刻の順。同じ時刻は並び順、無ければ先に入れた方が上", () => {
    const boat = item("高知→四万十の碧 乗船場所", "06:00", 1);
    const leave = item("ホテル出発", "06:00", 2);
    const later = item("受付", "08:15", 0);
    expect([later, leave, boat].sort(compareScheduleTime).map((i) => i.id)).toEqual([boat.id, leave.id, later.id]);
    // 入れ替えて番号を持つと、そちらが勝つ(番号の無い予定より上)。
    expect([later, { ...leave, sortOrder: 1 }, { ...boat, sortOrder: 2 }].sort(compareScheduleTime).map((i) => i.id)).toEqual([
      leave.id,
      boat.id,
      later.id,
    ]);
  });

  it("日付をまたいで並べる時は、日付が先", () => {
    const a = item("a", "06:00", 1, 1, "2026-12-30");
    const b = item("b", "09:00", 2, undefined, "2026-12-29");
    expect([a, b].sort(compareScheduleDateTime).map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("入れ替えられるのは、すぐ隣が同じ時刻の時だけ", () => {
    const day = [item("a", "06:00", 1), item("b", "06:00", 2), item("c", "08:15", 3)];
    expect(canSwapWithinTime(day, 0, -1)).toBe(false);
    expect(canSwapWithinTime(day, 0, 1)).toBe(true);
    expect(canSwapWithinTime(day, 1, 1)).toBe(false);
    expect(swapWithinTime(day, 1, 1)).toEqual([]);
  });

  it("同じ時刻のまとまりに 1, 2… を振り直し、変わる予定だけ返す", () => {
    const day = [item("a", "06:00", 1), item("b", "06:00", 2), item("c", "06:00", 3, 3), item("d", "08:15", 4)];
    expect(swapWithinTime(day, 1, -1)).toEqual([
      { id: "b", sortOrder: 1 },
      { id: "a", sortOrder: 2 },
    ]);
  });

  it("時刻の無い予定どうしも、同じ時刻として入れ替えられる", () => {
    const day = [item("a", undefined, 1), item("b", undefined, 2)];
    expect(swapWithinTime(day, 1, -1)).toEqual([
      { id: "b", sortOrder: 1 },
      { id: "a", sortOrder: 2 },
    ]);
  });
});
