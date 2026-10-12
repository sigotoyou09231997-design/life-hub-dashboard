import { describe, expect, it } from "vitest";
import type { TripExpense, TripScheduleItem } from "../types";
import { expensesOnDay } from "./tripDaySpend";

function expense(partial: Partial<TripExpense> & { id: string }): TripExpense {
  return { tripId: "t1", title: partial.id, amount: 1000, category: "other", paid: false, createdAt: 0, ...partial };
}

function plan(id: string, date: string): TripScheduleItem {
  return { id, tripId: "t1", date, title: id, type: "other", createdAt: 0 };
}

describe("expensesOnDay", () => {
  it("予定に付いていない費用は、支払日の日に入る", () => {
    const rows = [expense({ id: "a", paidDate: "2026-12-27" }), expense({ id: "b", paidDate: "2026-12-28" })];
    expect(expensesOnDay(rows, [], "2026-12-27").map((e) => e.id)).toEqual(["a"]);
  });

  it("予定に付いた費用は、予定の日を正とする(予定の日付を直したあと、支払日が古いままでも)", () => {
    const rows = [expense({ id: "ferry", scheduleId: "s1", paidDate: "2026-12-27" })];
    const schedule = [plan("s1", "2026-12-28")];
    expect(expensesOnDay(rows, schedule, "2026-12-27")).toEqual([]);
    expect(expensesOnDay(rows, schedule, "2026-12-28").map((e) => e.id)).toEqual(["ferry"]);
  });

  it("予定が消えている費用は、支払日に戻す", () => {
    const rows = [expense({ id: "a", scheduleId: "gone", paidDate: "2026-12-27" })];
    expect(expensesOnDay(rows, [], "2026-12-27").map((e) => e.id)).toEqual(["a"]);
  });

  it("日付の分からない費用は、どの日にも入れない", () => {
    expect(expensesOnDay([expense({ id: "a" })], [], "2026-12-27")).toEqual([]);
  });
});
