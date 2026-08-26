import { describe, expect, it } from "vitest";
import {
  buildTripQuickPlanRecords,
  describeTripQuickPlanSaved,
  hasTripQuickPlanError,
  resolveRouteFields,
  validateTripQuickPlan,
  type TripQuickPlanInput,
} from "./tripQuickPlan";
import { routeKey } from "./mailPlanImport";

function input(over: Partial<TripQuickPlanInput> = {}): TripQuickPlanInput {
  return {
    date: "2026-09-19",
    startTime: "10:00",
    title: "五稜郭",
    location: "北海道函館市五稜郭町44",
    type: "sightseeing",
    withExpense: false,
    withRoute: false,
    ...over,
  };
}

const ctx = { tripId: "t1", now: 1_700_000_000_000, nextSortOrder: 3 };

describe("旅行のまとめて入力", () => {
  it("スイッチを両方切っていれば、日程だけが増える", () => {
    const records = buildTripQuickPlanRecords(input(), ctx);

    expect(records.schedule).toMatchObject({
      tripId: "t1",
      date: "2026-09-19",
      startTime: "10:00",
      title: "五稜郭",
      location: "北海道函館市五稜郭町44",
      type: "sightseeing",
    });
    expect(records.expense).toBeUndefined();
    expect(records.route).toBeUndefined();
  });

  it("費用にも入れると、支払日と分類が日程から引き継がれる", () => {
    const records = buildTripQuickPlanRecords(
      input({ type: "transport", withExpense: true, amount: 12000, paid: true }),
      ctx,
    );

    expect(records.expense).toMatchObject({
      tripId: "t1",
      title: "五稜郭",
      amount: 12000,
      // 日程の「移動」は費用の「交通」に読み替える。
      category: "transport",
      paidDate: "2026-09-19",
      paid: true,
    });
  });

  it("費用の分類を自分で選んでいれば、そちらを使う", () => {
    const records = buildTripQuickPlanRecords(
      input({ type: "transport", withExpense: true, amount: 800, expenseCategory: "shopping" }),
      ctx,
    );

    expect(records.expense?.category).toBe("shopping");
  });

  it("金額が入っていない費用は作らない", () => {
    const records = buildTripQuickPlanRecords(input({ withExpense: true }), ctx);

    expect(records.expense).toBeUndefined();
    expect(hasTripQuickPlanError(validateTripQuickPlan(input({ withExpense: true })))).toBe(true);
  });

  it("ルートにも入れると、末尾に足され、何日目かも日程の日付になる", () => {
    const records = buildTripQuickPlanRecords(input({ withRoute: true }), ctx);

    expect(records.route).toMatchObject({
      tripId: "t1",
      // 名前と住所は、空欄ならタイトルと場所をそのまま引き継ぐ。
      name: "五稜郭",
      address: "北海道函館市五稜郭町44",
      sortOrder: 3,
      date: "2026-09-19",
      visited: false,
    });
    expect(records.routeSkipped).toBe(false);
  });

  it("ルートの名前と住所を書いていれば、そちらを使う", () => {
    const { name, address } = resolveRouteFields(
      input({ withRoute: true, routeName: "五稜郭タワー", routeAddress: "北海道函館市五稜郭町43-9" }),
    );

    expect(name).toBe("五稜郭タワー");
    expect(address).toBe("北海道函館市五稜郭町43-9");
  });

  it("同じ場所がもうルートにあるときは二重に並べない", () => {
    const records = buildTripQuickPlanRecords(input({ withRoute: true }), {
      ...ctx,
      existingRouteKeys: new Set([routeKey("北海道函館市五稜郭町44")]),
    });

    expect(records.route).toBeUndefined();
    expect(records.routeSkipped).toBe(true);
    // 日程はそれでも入る — 同じ場所に2度行く日程は普通にある。
    expect(records.schedule.title).toBe("五稜郭");
  });

  it("場所が空のままルートに入れようとしたら止める", () => {
    const errors = validateTripQuickPlan(input({ location: "", withRoute: true }));

    expect(errors.routeAddress).toBeTruthy();
    expect(hasTripQuickPlanError(errors)).toBe(true);
  });

  it("タイトルが空なら保存しない", () => {
    expect(validateTripQuickPlan(input({ title: "  " })).title).toBeTruthy();
    // 使わない欄の不足では止めない。
    expect(hasTripQuickPlanError(validateTripQuickPlan(input()))).toBe(false);
  });

  it("入れた先を知らせ文にする", () => {
    const both = buildTripQuickPlanRecords(input({ withExpense: true, amount: 1200, withRoute: true }), ctx);
    expect(describeTripQuickPlanSaved(both)).toBe("日程・費用・ルートに入れました");

    const skipped = buildTripQuickPlanRecords(input({ withExpense: true, amount: 1200, withRoute: true }), {
      ...ctx,
      existingRouteKeys: new Set([routeKey("北海道函館市五稜郭町44")]),
    });
    expect(describeTripQuickPlanSaved(skipped)).toBe("日程・費用に入れました(その場所はルートにもう入っています)");

    expect(describeTripQuickPlanSaved(buildTripQuickPlanRecords(input(), ctx))).toBe("日程に入れました");
  });
});
