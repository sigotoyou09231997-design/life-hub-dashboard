import { describe, expect, it } from "vitest";
import {
  TRIP_BUDGET_WARN_RATIO,
  buildTripBudgetPayload,
  isTripInScope,
  jstTodayStr,
  tripBudgetLevel,
} from "../functions/checkTripBudgetAndNotify";

const TODAY = "2026-09-04";

describe("jstTodayStr", () => {
  it("UTCの日付ではなくJSTの日付を返す", () => {
    // 2026-09-04 16:00 UTC = 2026-09-05 01:00 JST
    expect(jstTodayStr(Date.parse("2026-09-04T16:00:00Z"))).toBe("2026-09-05");
  });
});

describe("isTripInScope", () => {
  it("予算を決めていない旅行は対象外", () => {
    expect(isTripInScope({ budget: null, end_date: "2026-09-10" }, TODAY)).toBe(false);
    expect(isTripInScope({ budget: 0, end_date: "2026-09-10" }, TODAY)).toBe(false);
  });

  it("終わった旅行は対象外(もう使い方を変えられないため)", () => {
    expect(isTripInScope({ budget: 100_000, end_date: "2026-09-03" }, TODAY)).toBe(false);
  });

  it("今日終わる旅行・これからの旅行は対象", () => {
    expect(isTripInScope({ budget: 100_000, end_date: TODAY }, TODAY)).toBe(true);
    expect(isTripInScope({ budget: 100_000, end_date: "2026-12-31" }, TODAY)).toBe(true);
  });
});

describe("tripBudgetLevel", () => {
  it("予算を超えたら over", () => {
    expect(tripBudgetLevel(100_001, 100_000)).toBe("over");
  });

  it("ちょうど使い切ったところはまだ near(超えてはいない)", () => {
    expect(tripBudgetLevel(100_000, 100_000)).toBe("near");
  });

  it("8割に届いたら near", () => {
    expect(tripBudgetLevel(100_000 * TRIP_BUDGET_WARN_RATIO, 100_000)).toBe("near");
    expect(tripBudgetLevel(79_999, 100_000)).toBe("ok");
  });

  it("予算が0以下のときは何も言わない", () => {
    expect(tripBudgetLevel(5_000, 0)).toBe("ok");
  });
});

describe("buildTripBudgetPayload", () => {
  it("超えたときは超過額を出し、その旅行の画面へ飛ばす", () => {
    const payload = JSON.parse(buildTripBudgetPayload("北海道旅行", "t-1", 118_000, 100_000, "over"));
    expect(payload.title).toBe("北海道旅行の予算を ¥18,000 超えました");
    expect(payload.body).toBe("予算 ¥100,000 のうち ¥118,000 を使いました。");
    expect(payload.url).toBe("/trips/t-1");
  });

  it("近づいたときは残額を出す", () => {
    const payload = JSON.parse(buildTripBudgetPayload("北海道旅行", "t-1", 85_000, 100_000, "near"));
    expect(payload.title).toBe("北海道旅行の予算が残り ¥15,000 です");
  });
});
