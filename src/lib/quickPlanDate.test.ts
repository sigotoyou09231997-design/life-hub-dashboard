import { describe, expect, it } from "vitest";
import { quickPlanDefaultDate } from "./quickPlanDate";

const dayList = ["2026-10-15", "2026-10-16", "2026-10-17"];

describe("quickPlanDefaultDate(まとめて追加の日付の初期値)", () => {
  it("日程のタブでは、見ている日(今日や1日目ではなく)", () => {
    expect(quickPlanDefaultDate({ tab: "schedule", routeDay: null, dayList, activeScheduleDay: "2026-10-17" })).toBe("2026-10-17");
  });

  it("ルートのタブでは、ルートで選んでいる日。選んでいなければ、日程で見ている日", () => {
    expect(quickPlanDefaultDate({ tab: "route", routeDay: "2026-10-17", dayList, activeScheduleDay: "2026-10-15" })).toBe("2026-10-17");
    expect(quickPlanDefaultDate({ tab: "route", routeDay: null, dayList, activeScheduleDay: "2026-10-16" })).toBe("2026-10-16");
  });

  it("ルートの日が旅行の日にちに無ければ(期間を直した後など)、日程で見ている日", () => {
    expect(quickPlanDefaultDate({ tab: "route", routeDay: "2026-12-01", dayList, activeScheduleDay: "2026-10-15" })).toBe("2026-10-15");
  });

  it("費用など、ほかのタブでは、ルートの日に引きずられず、日程で見ている日", () => {
    expect(quickPlanDefaultDate({ tab: "expense", routeDay: "2026-10-17", dayList, activeScheduleDay: "2026-10-16" })).toBe("2026-10-16");
  });
});
