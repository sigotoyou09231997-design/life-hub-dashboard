import { describe, expect, it } from "vitest";
import type { TimedSpan } from "./eventSpan";
import {
  assignLanes,
  blockBox,
  hourRangeFor,
  isTimedBlock,
  placeOverlapping,
  stripSegments,
  timedBlocksOn,
  rollingWeekDatesOf,
  weekDatesOf,
  weekTitle,
} from "./weekLayout";

type Item = TimedSpan & { id: string };

// 2026-10-12 は月曜。
const WEEK = weekDatesOf("2026-10-14");

describe("rollingWeekDatesOf(今日から7日)", () => {
  it("その日から7日(月曜はじまりにしない)", () => {
    expect(rollingWeekDatesOf("2026-10-18")).toEqual(["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
  });
});

describe("weekDatesOf / weekTitle", () => {
  it("月曜はじまりの7日を返す(月表示と同じ並び)", () => {
    expect(WEEK).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
    // 日曜を渡しても、その前の月曜からの週になる(日曜はじまりにしない)。
    expect(weekDatesOf("2026-10-18")[0]).toBe("2026-10-12");
  });

  it("見出しは、月・年をまたぐ所だけ書き足す", () => {
    expect(weekTitle(WEEK)).toBe("2026年10月12日〜18日");
    expect(weekTitle(weekDatesOf("2026-10-28"))).toBe("2026年10月26日〜11月1日");
    expect(weekTitle(weekDatesOf("2026-12-30"))).toBe("2026年12月28日〜2027年1月3日");
  });
});

describe("時刻の枠に置く予定", () => {
  it("終日・何日かにまたがる・開始時刻なしは、時刻の枠に置かない", () => {
    expect(isTimedBlock({ date: "2026-10-12", startTime: "10:00" })).toBe(true);
    expect(isTimedBlock({ date: "2026-10-12", startTime: "10:00", allDay: true })).toBe(false);
    expect(isTimedBlock({ date: "2026-10-12", endDate: "2026-10-13", startTime: "15:00" })).toBe(false);
    expect(isTimedBlock({ date: "2026-10-12" })).toBe(false);
  });

  it("終了が無い予定は1時間、終了が開始より前でも1時間として描く", () => {
    const items: Item[] = [
      { id: "a", date: "2026-10-12", startTime: "10:00" },
      { id: "b", date: "2026-10-12", startTime: "13:00", endTime: "12:00" },
      { id: "c", date: "2026-10-12", startTime: "15:30", endTime: "16:15" },
    ];
    expect(timedBlocksOn(items, "2026-10-12").map((b) => [b.item.id, b.start, b.end])).toEqual([
      ["a", 600, 660],
      ["b", 780, 840],
      ["c", 930, 975],
    ]);
  });

  it("繰り返しの予定は、将来の回の日にも出る", () => {
    const yoga: Item = { id: "yoga", date: "2026-10-06", startTime: "07:00", endTime: "08:00", repeat: "weekly" };
    expect(timedBlocksOn([yoga], "2026-10-13")).toHaveLength(1);
    expect(timedBlocksOn([yoga], "2026-10-14")).toHaveLength(0);
  });
});

describe("placeOverlapping(重なる予定を横に並べる)", () => {
  const block = (id: string, start: number, end: number) => ({ item: id, start, end });

  it("重ならない予定は、どれも1列(幅いっぱい)", () => {
    const placed = placeOverlapping([block("a", 600, 660), block("b", 660, 720)]);
    expect(placed.map((p) => [p.item, p.column, p.columns])).toEqual([
      ["a", 0, 1],
      ["b", 0, 1],
    ]);
  });

  it("重なる2件は、左右に半分ずつ", () => {
    const placed = placeOverlapping([block("面接", 810, 900), block("面談", 780, 840)]);
    expect(placed.map((p) => [p.item, p.column, p.columns])).toEqual([
      ["面談", 0, 2],
      ["面接", 1, 2],
    ]);
  });

  it("3件がつながって重なっても、空いた列は詰めて使う", () => {
    // a(9-11) と b(10-12) が重なり、c(11-12) は a が終わった左の列に入る。
    const placed = placeOverlapping([block("a", 540, 660), block("b", 600, 720), block("c", 660, 720)]);
    expect(placed.map((p) => [p.item, p.column, p.columns])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
    ]);
  });

  it("1か所だけ重なっていても、ほかの時間の予定は細らない", () => {
    const placed = placeOverlapping([block("朝", 480, 540), block("x", 600, 660), block("y", 630, 690)]);
    const byId = Object.fromEntries(placed.map((p) => [p.item, p.columns]));
    expect(byId).toEqual({ 朝: 1, x: 2, y: 2 });
  });

  it("短い予定は画面で1行ぶんの高さを取るので、すぐ後の予定とは横に並べる", () => {
    // 10:00〜10:10 と 10:15〜: 時刻だけなら重ならないが、描くと重なる。
    const placed = placeOverlapping([block("短い", 600, 610), block("次", 615, 675)]);
    expect(placed.map((p) => p.columns)).toEqual([2, 2]);
  });
});

describe("位置の計算", () => {
  it("ふだんは8〜21時。はみ出す予定がある週だけ広げる", () => {
    expect(hourRangeFor([])).toEqual({ start: 8, end: 21 });
    expect(hourRangeFor([{ start: 420, end: 480 }])).toEqual({ start: 7, end: 21 });
    expect(hourRangeFor([{ start: 1290, end: 1350 }])).toEqual({ start: 8, end: 23 });
    expect(hourRangeFor([{ start: 1410, end: 1440 }])).toEqual({ start: 8, end: 24 });
  });

  it("上端からの割合と高さを返す", () => {
    const range = { start: 8, end: 20 }; // 12時間
    expect(blockBox(600, 660, range)).toEqual({ top: (120 / 720) * 100, height: (60 / 720) * 100 });
  });

  it("枠の外にはみ出す分は切る", () => {
    const box = blockBox(420, 540, { start: 8, end: 20 });
    expect(box.top).toBe(0);
    expect(box.height).toBeCloseTo((60 / 720) * 100);
  });
});

describe("上の帯(終日・何日かにまたがる予定)", () => {
  const keyOf = (item: Item) => item.id;

  it("何日かにまたがる予定は、かかっている列をまたぐ1本の帯になる", () => {
    const stay: Item = { id: "stay", date: "2026-10-14", endDate: "2026-10-16", startTime: "15:00", endTime: "10:00" };
    expect(stripSegments([stay], WEEK, keyOf)).toEqual([
      expect.objectContaining({ key: "stay-2026-10-14", startCol: 2, endCol: 4, continuesBefore: false, continuesAfter: false }),
    ]);
  });

  it("週をまたぐ予定は、前後に続いている印を持つ", () => {
    const trip: Item = { id: "trip", date: "2026-10-10", endDate: "2026-10-20", allDay: true };
    expect(stripSegments([trip], WEEK, keyOf)).toEqual([
      expect.objectContaining({ startCol: 0, endCol: 6, continuesBefore: true, continuesAfter: true }),
    ]);
  });

  it("毎週の2日間の予定は、回ごとに別の帯になる", () => {
    const camp: Item = { id: "camp", date: "2026-10-03", endDate: "2026-10-04", allDay: true, repeat: "weekly" };
    const segments = stripSegments([camp], weekDatesOf("2026-10-12"), keyOf);
    // 10/10(土)〜10/11(日)の回は前の週、10/17(土)〜10/18(日)の回がこの週。
    expect(segments.map((s) => [s.startCol, s.endCol])).toEqual([[5, 6]]);
  });

  it("時刻のある1日の予定は帯に入れない(時刻の枠に置く)", () => {
    const items: Item[] = [
      { id: "timed", date: "2026-10-12", startTime: "10:00" },
      { id: "allday", date: "2026-10-12", allDay: true },
      { id: "notime", date: "2026-10-13" },
    ];
    expect(stripSegments(items, WEEK, keyOf).map((s) => s.item.id)).toEqual(["allday", "notime"]);
  });

  it("段は、空いているいちばん上へ。同じ列から始まるなら長い帯が先", () => {
    const laned = assignLanes([
      { id: "短い", startCol: 1, endCol: 1 },
      { id: "長い", startCol: 1, endCol: 3 },
      { id: "後", startCol: 4, endCol: 4 },
      { id: "重なる", startCol: 2, endCol: 2 },
    ]);
    expect(laned.map((s) => [s.id, s.lane])).toEqual([
      ["長い", 0],
      ["短い", 1],
      ["重なる", 1],
      ["後", 0],
    ]);
  });
});
