import { describe, expect, it } from "vitest";
import type { TripScheduleItem } from "../types";
import { connectorMinutes, connectorModes, formatMinutes, segmentSchedule } from "./scheduleConnectors";

function item(partial: Partial<TripScheduleItem> & { id: string; title: string }): TripScheduleItem {
  return { tripId: "t", date: "2026-12-27", type: "other", createdAt: 0, ...partial };
}

const DAY = [
  item({ id: "wake", title: "起床", startTime: "05:00" }),
  item({ id: "m1", title: "小金井→東京", type: "transport", transportMode: "train", startTime: "05:30", endTime: "06:30" }),
  item({ id: "m2", title: "東京→岡山", type: "transport", transportMode: "shinkansen", startTime: "06:48", endTime: "10:05" }),
  item({ id: "m3", title: "岡山→高松", type: "transport", transportMode: "train", startTime: "10:20" }),
  item({ id: "udon", title: "うどん", type: "meal", startTime: "11:51" }),
  item({ id: "m4", title: "高松→屋島", type: "transport", startTime: "13:00" }),
];

describe("続けて並ぶ移動を1本の「つなぎ」に(第6弾 D-1)", () => {
  it("移動3件が1本にまとまり、場所の予定のあいだに入る。日の最後の移動も1本になる", () => {
    const segments = segmentSchedule(DAY);
    expect(segments.map((s) => (s.kind === "item" ? s.item.id : `[${s.items.map((i) => i.id).join("+")}]`))).toEqual([
      "wake",
      "[m1+m2+m3]",
      "udon",
      "[m4]",
    ]);
    const first = segments[1];
    expect(first.kind === "connector" && first.next?.id).toBe("udon");
    const last = segments[3];
    expect(last.kind === "connector" && last.next).toBeNull();
    expect(segments.every((s) => s.kind !== "connector" || !s.open)).toBe(true);
  });

  it("開いているつなぎは、札の後ろに中の予定を1件ずつ続ける。expandAll なら全部", () => {
    const opened = segmentSchedule(DAY, { open: new Set(["m1+m2+m3"]) });
    expect(opened.map((s) => (s.kind === "item" ? s.item.id : "札"))).toEqual(["wake", "札", "m1", "m2", "m3", "udon", "札"]);
    const all = segmentSchedule(DAY, { expandAll: true });
    expect(all.filter((s) => s.kind === "item")).toHaveLength(DAY.length);
  });

  it("移動しか無い日・移動で始まる日も崩れない", () => {
    const only = segmentSchedule([DAY[1], DAY[2]]);
    expect(only).toHaveLength(1);
    expect(only[0].kind).toBe("connector");
    const starts = segmentSchedule([DAY[1], DAY[4]]);
    expect(starts.map((s) => s.kind)).toEqual(["connector", "item"]);
    expect(segmentSchedule([])).toEqual([]);
  });

  it("移動手段は「・」でつなぐ分だけ集める(同じものは1回、選んでいない移動は数えない)", () => {
    expect(connectorModes([DAY[1], DAY[2], DAY[3], DAY[5]])).toEqual(["train", "shinkansen"]);
  });

  it("所要時間は最初の開始から最後の終了まで。終了が無ければ次の場所の予定の開始まで。出せない時は null", () => {
    expect(connectorMinutes([DAY[1], DAY[2], DAY[3]], DAY[4])).toBe(6 * 60 + 21);
    expect(connectorMinutes([DAY[1], DAY[2]], DAY[3])).toBe(4 * 60 + 35);
    expect(connectorMinutes([DAY[5]], null)).toBeNull();
    expect(connectorMinutes([item({ id: "x", title: "移動", type: "transport" })], DAY[4])).toBeNull();
    expect(connectorMinutes([item({ id: "x", title: "移動", type: "transport", startTime: "12:00", endTime: "11:00" })], null)).toBeNull();
  });

  it("所要時間の書き方", () => {
    expect(formatMinutes(45)).toBe("45分");
    expect(formatMinutes(120)).toBe("2時間");
    expect(formatMinutes(381)).toBe("6時間21分");
  });
});
