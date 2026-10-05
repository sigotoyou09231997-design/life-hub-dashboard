import { describe, expect, it } from "vitest";
import { timelineTimeParts } from "./tripTimeline";

describe("時間軸の左の列に出す時刻", () => {
  it("開始時刻だけなら、時刻をそのまま出す", () => {
    expect(timelineTimeParts({ date: "2026-12-27", startTime: "04:57" }, "2026-12-27")).toEqual({
      main: "04:57",
      plain: false,
    });
  });

  it("終了時刻があれば、開始の下に「〜終了」を小さく出す(移動の到着など)", () => {
    expect(timelineTimeParts({ date: "2026-12-27", startTime: "06:48", endTime: "10:10" }, "2026-12-27")).toEqual({
      main: "06:48",
      sub: "〜10:10",
      plain: false,
    });
  });

  it("時刻が無い日程は、時刻ではない言葉として淡く出す", () => {
    expect(timelineTimeParts({ date: "2026-12-28" }, "2026-12-28")).toEqual({ main: "時刻なし", plain: true });
  });

  it("終日の日程は「終日」", () => {
    expect(timelineTimeParts({ date: "2026-12-28", allDay: true }, "2026-12-28")).toEqual({ main: "終日", plain: true });
  });

  it("またがる日程は、初日は開始から・最終日は終了まで・間の日は終日として出す", () => {
    // 毎日その時間に何かがあるように読ませない(spanTimeText の決まりをそのまま使う)。
    const stay = { date: "2026-12-27", endDate: "2026-12-29", startTime: "15:00", endTime: "10:00" };
    expect(timelineTimeParts(stay, "2026-12-27")).toEqual({ main: "15:00", sub: "から", plain: false });
    expect(timelineTimeParts(stay, "2026-12-28")).toEqual({ main: "終日", plain: true });
    expect(timelineTimeParts(stay, "2026-12-29")).toEqual({ main: "10:00", sub: "まで", plain: false });
  });
});
