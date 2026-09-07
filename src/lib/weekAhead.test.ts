import { describe, expect, it } from "vitest";
import { groupWeekAhead, hasWeekAheadItems, weekAheadDates } from "./weekAhead";

const today = "2026-09-07";

describe("weekAheadDates", () => {
  it("今日は含めず、翌日から並べる(今日は上のカードが受け持っているため)", () => {
    expect(weekAheadDates(today, 3)).toEqual(["2026-09-08", "2026-09-09", "2026-09-10"]);
  });

  it("月をまたいでも日付が飛ばない", () => {
    expect(weekAheadDates("2026-09-29", 3)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
  });

  it("0日以下なら空", () => {
    expect(weekAheadDates(today, 0)).toEqual([]);
    expect(weekAheadDates(today, -1)).toEqual([]);
  });
});

describe("groupWeekAhead", () => {
  it("日付ごとに、その日の予定だけを入れる", () => {
    const events = [
      { id: "a", date: "2026-09-08", startTime: "10:00" },
      { id: "b", date: "2026-09-10", startTime: "09:00" },
    ];
    const days = groupWeekAhead(events, weekAheadDates(today, 3));
    expect(days.map((d) => d.items.map((i) => i.id))).toEqual([["a"], [], ["b"]]);
  });

  it("予定が1件も無い日も、日付の枠だけは残す(週の並びが崩れないように)", () => {
    const days = groupWeekAhead([], weekAheadDates(today, 7));
    expect(days).toHaveLength(7);
    expect(days.every((d) => d.items.length === 0)).toBe(true);
  });

  it("何日かにまたがる予定は、かかっている日すべてに出る", () => {
    const stay = [{ id: "trip", date: "2026-09-09", endDate: "2026-09-11", startTime: "15:00" }];
    const days = groupWeekAhead(stay, weekAheadDates(today, 7));
    expect(days.filter((d) => d.items.length > 0).map((d) => d.date)).toEqual([
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
    ]);
  });

  it("繰り返しの予定も、先の回が出る", () => {
    const weekly = [{ id: "w", date: "2026-09-01", startTime: "19:00", repeat: "weekly" as const }];
    const days = groupWeekAhead(weekly, weekAheadDates(today, 7));
    // 9/1(火)の毎週 → この範囲では 9/8 だけ
    expect(days.filter((d) => d.items.length > 0).map((d) => d.date)).toEqual(["2026-09-08"]);
  });

  it("時刻の早い順に並ぶ", () => {
    const events = [
      { id: "late", date: "2026-09-08", startTime: "18:30" },
      { id: "early", date: "2026-09-08", startTime: "09:00" },
    ];
    const [day] = groupWeekAhead(events, weekAheadDates(today, 1));
    expect(day.items.map((i) => i.id)).toEqual(["early", "late"]);
  });

  it("終日の予定は、時刻のある予定より先に並ぶ", () => {
    const events = [
      { id: "timed", date: "2026-09-08", startTime: "09:00" },
      { id: "allday", date: "2026-09-08", allDay: true },
    ];
    const [day] = groupWeekAhead(events, weekAheadDates(today, 1));
    expect(day.items.map((i) => i.id)).toEqual(["allday", "timed"]);
  });

  it("またがる予定の2日目以降は、初日の時刻で割り込まない", () => {
    // 宿泊(9/8 15:00〜9/9)と、9/9の朝の予定。9日は宿泊が「15:00の予定」として
    // 朝の予定より後ろへ回ってはいけない(泊まっている最中なので終日あつかい)。
    const events = [
      { id: "stay", date: "2026-09-08", endDate: "2026-09-09", startTime: "15:00" },
      { id: "morning", date: "2026-09-09", startTime: "09:00" },
    ];
    const days = groupWeekAhead(events, weekAheadDates(today, 2));
    expect(days[1].items.map((i) => i.id)).toEqual(["stay", "morning"]);
  });
});

describe("hasWeekAheadItems", () => {
  it("1件でもあれば true、全部空なら false", () => {
    const dates = weekAheadDates(today, 3);
    expect(hasWeekAheadItems(groupWeekAhead([], dates))).toBe(false);
    expect(hasWeekAheadItems(groupWeekAhead([{ date: "2026-09-09" }], dates))).toBe(true);
  });
});
