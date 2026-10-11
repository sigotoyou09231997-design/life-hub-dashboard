import { describe, expect, it } from "vitest";
import type { TripScheduleItem } from "../types";
import { canMove, moveInDay, orderSchedule, orderScheduleDay } from "./scheduleOrder";

function item(id: string, startTime: string | undefined, createdAt: number, sortOrder?: number | null, date = "2026-12-29"): TripScheduleItem {
  return { id, tripId: "t", date, startTime, title: id, type: "other", createdAt, sortOrder };
}

const ids = (items: TripScheduleItem[]) => items.map((i) => i.id);

describe("予定の並び(1日ぶん)", () => {
  it("入れ替えていない日は時刻の順。同じ時刻なら先に入れた方が上", () => {
    expect(ids(orderScheduleDay([item("c", "08:15", 0), item("b", "06:00", 2), item("a", "06:00", 1)]))).toEqual(["a", "b", "c"]);
  });

  it("入れ替えた日は、時刻に関係なくその順", () => {
    // 04:30 の「起床」を 04:15 の「自宅出発」より上へ動かした形。
    const day = [item("起床", "03:27", 1, 1), item("自宅出発", "04:15", 2, 3), item("起床2", "04:30", 3, 2)];
    expect(ids(orderScheduleDay(day))).toEqual(["起床", "起床2", "自宅出発"]);
  });

  it("入れ替えた後に足した予定(番号なし)は、時刻を見て差し込む", () => {
    const day = [item("a", "06:00", 1, 2), item("b", "06:00", 2, 1), item("c", "09:00", 3, 3), item("new", "07:00", 4)];
    expect(ids(orderScheduleDay(day))).toEqual(["b", "a", "new", "c"]);
  });

  it("同期で降りてきた null は、番号なしとして扱う", () => {
    expect(ids(orderScheduleDay([item("b", "09:00", 2, null), item("a", "06:00", 1, null)]))).toEqual(["a", "b"]);
  });

  it("旅行全体は、日付の順に日ごとの並びで", () => {
    const all = [item("x", "06:00", 1, 2, "2026-12-30"), item("y", "09:00", 2, 1, "2026-12-30"), item("z", "12:00", 3, undefined, "2026-12-29")];
    expect(ids(orderSchedule(all))).toEqual(["z", "y", "x"]);
  });
});

describe("上下の入れ替え", () => {
  it("どの予定も、端でなければ上にも下にも動かせる(時刻がちがっても)", () => {
    const day = [item("a", "03:27", 1), item("b", "04:15", 2), item("c", "04:30", 3)];
    expect(canMove(day, 0, -1)).toBe(false);
    expect(canMove(day, 0, 1)).toBe(true);
    expect(canMove(day, 2, 1)).toBe(false);
    expect(moveInDay(day, 2, 1)).toEqual([]);
  });

  it("動かすと、その日の全部に 1, 2… を振り直し、変わる予定だけ返す", () => {
    const day = [item("a", "03:27", 1), item("b", "04:15", 2), item("c", "04:30", 3)];
    expect(moveInDay(day, 2, -1)).toEqual([
      { id: "a", sortOrder: 1 },
      { id: "c", sortOrder: 2 },
      { id: "b", sortOrder: 3 },
    ]);
    const after = orderScheduleDay(day.map((i) => ({ ...i, sortOrder: { a: 1, c: 2, b: 3 }[i.id!] })));
    expect(ids(after)).toEqual(["a", "c", "b"]);
  });
});
