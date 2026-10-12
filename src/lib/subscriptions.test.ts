import { describe, expect, it } from "vitest";
import type { FixedCost, SubscriptionDetail } from "../types";
import {
  billingDatesInRange,
  chargeInPeriod,
  cycleProgress,
  monthlyEquivalent,
  nextBillingDate,
  pairSubscriptions,
  remainingLabel,
  scheduleLabel,
  sortByNextBilling,
  statusOf,
  summarizeSubscriptions,
  urgencyOf,
  yearlyEquivalent,
  type SubscriptionItem,
} from "./subscriptions";

function item(cost: Partial<FixedCost> = {}, detail?: Partial<SubscriptionDetail>): SubscriptionItem {
  const id = cost.id ?? "c1";
  return {
    cost: { id, title: "Netflix", category: "動画", amount: 1_590, dueDay: 20, active: true, ...cost },
    detail: detail ? { fixedCostId: id, cycle: "monthly", createdAt: 0, ...detail } : undefined,
  };
}

describe("pairSubscriptions", () => {
  it("固定費に付け足しを組む。無いものは detail なし", () => {
    const pairs = pairSubscriptions(
      [item({ id: "a" }).cost, item({ id: "b" }).cost],
      [{ fixedCostId: "b", cycle: "yearly", billingMonth: 3, createdAt: 0 }],
    );
    expect(pairs[0].detail).toBeUndefined();
    expect(pairs[1].detail?.cycle).toBe("yearly");
  });
});

describe("nextBillingDate", () => {
  it("毎月払い: 今月の請求日がまだなら今月、過ぎていれば来月", () => {
    expect(nextBillingDate(item({ dueDay: 20 }), "2026-10-12")).toBe("2026-10-20");
    expect(nextBillingDate(item({ dueDay: 5 }), "2026-10-12")).toBe("2026-11-05");
  });

  it("今日が請求日なら今日", () => {
    expect(nextBillingDate(item({ dueDay: 12 }), "2026-10-12")).toBe("2026-10-12");
  });

  it("31日払いは月末に丸める", () => {
    expect(nextBillingDate(item({ dueDay: 31 }), "2026-02-10")).toBe("2026-02-28");
  });

  it("年払い: 請求月が来るまで先へ進む", () => {
    expect(nextBillingDate(item({ dueDay: 1 }, { cycle: "yearly", billingMonth: 3 }), "2026-10-12")).toBe("2027-03-01");
    expect(nextBillingDate(item({ dueDay: 15 }, { cycle: "yearly", billingMonth: 10 }), "2026-10-12")).toBe("2026-10-15");
  });

  it("無料体験中は、体験が終わる日が最初の請求日", () => {
    const trial = item({ dueDay: 25 }, { trialEndDate: "2026-10-25" });
    expect(nextBillingDate(trial, "2026-10-12")).toBe("2026-10-25");
  });

  it("開始予定は、開始日以降の最初の請求日", () => {
    const later = item({ dueDay: 1 }, { startDate: "2026-12-01" });
    expect(nextBillingDate(later, "2026-10-12")).toBe("2026-12-01");
  });

  it("解約したものは null", () => {
    expect(nextBillingDate(item({ active: false }), "2026-10-12")).toBeNull();
  });
});

describe("statusOf", () => {
  it("体験の終わる日の前日までは trial、当日からは active", () => {
    const trial = item({}, { trialEndDate: "2026-10-20" });
    expect(statusOf(trial, "2026-10-19")).toBe("trial");
    expect(statusOf(trial, "2026-10-20")).toBe("active");
  });

  it("開始日が未来なら scheduled", () => {
    expect(statusOf(item({}, { startDate: "2026-11-01" }), "2026-10-12")).toBe("scheduled");
  });

  it("止めている固定費は cancelled", () => {
    expect(statusOf(item({ active: false }), "2026-10-12")).toBe("cancelled");
  });
});

describe("billingDatesInRange", () => {
  it("年払いは請求月にだけ出る", () => {
    const yearly = item({ dueDay: 10 }, { cycle: "yearly", billingMonth: 11 });
    expect(billingDatesInRange(yearly, "2026-10-01", "2027-10-31")).toEqual(["2026-11-10"]);
  });

  it("請求が始まる前の日は入れない", () => {
    const trial = item({ dueDay: 20 }, { trialEndDate: "2026-11-20" });
    expect(billingDatesInRange(trial, "2026-10-01", "2026-12-31")).toEqual(["2026-11-20", "2026-12-20"]);
  });

  it("年をまたぐ範囲も数える", () => {
    expect(billingDatesInRange(item({ dueDay: 5 }), "2026-12-01", "2027-01-31")).toEqual(["2026-12-05", "2027-01-05"]);
  });
});

describe("chargeInPeriod(使えるお金から引く額)", () => {
  it("付け足しの無い毎月払いは、いままでどおり1期に1回ぶん", () => {
    expect(chargeInPeriod(item({ amount: 1_000, dueDay: 3 }), "2026-09-25", "2026-10-24")).toBe(1_000);
  });

  it("年払いは請求日が期の中にあるときだけ", () => {
    const yearly = item({ amount: 12_000, dueDay: 10 }, { cycle: "yearly", billingMonth: 10 });
    expect(chargeInPeriod(yearly, "2026-09-25", "2026-10-24")).toBe(12_000);
    expect(chargeInPeriod(yearly, "2026-10-25", "2026-11-24")).toBe(0);
  });

  it("無料体験が期の後で終わるなら、その期は0", () => {
    const trial = item({ amount: 1_000 }, { trialEndDate: "2026-11-01" });
    expect(chargeInPeriod(trial, "2026-09-25", "2026-10-24")).toBe(0);
    expect(chargeInPeriod(trial, "2026-10-25", "2026-11-24")).toBe(1_000);
  });

  it("解約したものは0", () => {
    expect(chargeInPeriod(item({ active: false }), "2026-09-25", "2026-10-24")).toBe(0);
  });
});

describe("金額の換算と表示", () => {
  it("年払いは12で割って月額、毎月払いは12倍で年額", () => {
    const yearly = item({ amount: 5_900 }, { cycle: "yearly", billingMonth: 4 });
    expect(monthlyEquivalent(yearly)).toBeCloseTo(491.67, 1);
    expect(yearlyEquivalent(item({ amount: 1_000 }))).toBe(12_000);
  });

  it("請求の決まりの書き方", () => {
    expect(scheduleLabel(item({ dueDay: 20 }))).toBe("毎月20日");
    expect(scheduleLabel(item({ dueDay: 1 }, { cycle: "yearly", billingMonth: 3 }))).toBe("毎年3月1日");
  });

  it("残り日数の書き方と色の段階", () => {
    expect(remainingLabel(0)).toBe("今日");
    expect(remainingLabel(1)).toBe("明日");
    expect(remainingLabel(9)).toBe("あと9日");
    expect(urgencyOf(1)).toBe("urgent");
    expect(urgencyOf(5)).toBe("soon");
    expect(urgencyOf(20)).toBe("calm");
  });

  it("周期の進み具合は前の請求日から数える", () => {
    // 9/20 → 10/20 の30日のうち、10/5 は15日目
    expect(cycleProgress(item({ dueDay: 20 }), "2026-10-05")).toBeCloseTo(0.5, 2);
  });
});

describe("summarizeSubscriptions", () => {
  const today = "2026-10-12";
  const items = [
    item({ id: "n", amount: 1_590, dueDay: 20, category: "動画" }),
    item({ id: "s", title: "Spotify", amount: 1_080, dueDay: 3, category: "音楽" }),
    item({ id: "p", title: "Amazonプライム", amount: 5_900, dueDay: 15, category: "買い物" }, { cycle: "yearly", billingMonth: 10 }),
    item({ id: "t", title: "U-NEXT", amount: 2_189, dueDay: 30 }, { trialEndDate: "2026-10-30" }),
    item({ id: "x", title: "Hulu", amount: 1_026, dueDay: 1, active: false }, { cancelledAt: "2026-08-15" }),
  ];
  const summary = summarizeSubscriptions(items, today);

  it("合計に入れるのは請求が続いているものだけ(体験中・解約は入れない)", () => {
    expect(summary.active.map((i) => i.cost.id)).toEqual(["n", "s", "p"]);
    expect(summary.monthlyTotal).toBeCloseTo(1_590 + 1_080 + 5_900 / 12, 5);
    expect(summary.yearlyTotal).toBe((1_590 + 1_080) * 12 + 5_900);
    expect(summary.yearlyCount).toBe(1);
    expect(summary.trial).toHaveLength(1);
    expect(summary.cancelled).toHaveLength(1);
  });

  it("今月実際に払う額は、今月に請求日が来るものだけ(体験が今月終わるものも入る)", () => {
    expect(summary.thisMonthCharge).toBe(1_590 + 1_080 + 5_900 + 2_189);
  });

  it("上位3件とカテゴリ別", () => {
    expect(summary.top.map((i) => i.cost.id)).toEqual(["n", "s", "p"]);
    expect(summary.byCategory[0].category).toBe("動画");
  });

  it("解約で浮いた額: 解約した翌日から今日までに来るはずだった請求", () => {
    // 9/1・10/1 の2回
    expect(summary.savedMonthly).toBe(1_026);
    expect(summary.savedSoFar).toBe(2_052);
  });
});

describe("sortByNextBilling", () => {
  it("次の請求日が近い順、解約したものは後ろ", () => {
    const sorted = sortByNextBilling(
      [item({ id: "late", dueDay: 30 }), item({ id: "off", active: false }), item({ id: "soon", dueDay: 13 })],
      "2026-10-12",
    );
    expect(sorted.map((i) => i.cost.id)).toEqual(["soon", "late", "off"]);
  });
});
