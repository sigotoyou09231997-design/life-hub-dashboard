/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { TripExpense, TripScheduleItem } from "../../types";
import type { TripWeather } from "../../lib/weather";
import { TripDayPanel } from "./TripDayPanel";

const DAY1 = "2026-12-27";
const DAY2 = "2026-12-28";

function plan(id: string, date: string, location?: string, startTime?: string): TripScheduleItem {
  return { id, tripId: "t1", date, title: id, location, startTime, type: "sightseeing", createdAt: 0 };
}

function expense(partial: Partial<TripExpense> & { id: string; amount: number }): TripExpense {
  return { tripId: "t1", title: partial.id, category: "other", paid: false, createdAt: 0, ...partial };
}

const SCHEDULE = [plan("東京発", DAY1, "東京駅", "06:48"), plan("高松着", DAY1, "高松駅", "11:18"), plan("屋島", DAY2, "屋島", "10:00")];
const EXPENSES = [
  expense({ id: "新幹線", amount: 17000, scheduleId: "東京発", paidDate: DAY1, paidBy: "えっくん" }),
  expense({ id: "うどん", amount: 1200, paidDate: DAY1 }),
  expense({ id: "ケーブルカー", amount: 900, paidDate: DAY2 }),
  expense({ id: "保険", amount: 3000 }),
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof TripDayPanel>> = {}) {
  const onEditExpense = vi.fn();
  const onShowExpenses = vi.fn();
  render(
    <TripDayPanel
      date={DAY1}
      dayNumber={1}
      schedule={SCHEDULE}
      expenses={EXPENSES}
      budget={100000}
      onEditExpense={onEditExpense}
      onShowExpenses={onShowExpenses}
      {...overrides}
    />,
  );
  return { onEditExpense, onShowExpenses };
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("PCの日程の右の欄(TripDayPanel)", () => {
  it("見ている日の費用だけを並べ、その日の合計と旅行全体の合計を出す", () => {
    renderPanel();
    const section = screen.getByRole("region", { name: "この日の費用" });
    expect(within(section).getByRole("button", { name: "新幹線の費用を編集" })).toBeTruthy();
    expect(within(section).getByRole("button", { name: "うどんの費用を編集" })).toBeTruthy();
    expect(within(section).queryByText("ケーブルカー")).toBeNull();
    expect(within(section).getByRole("heading").textContent).toContain("¥18,200");
    expect(section.textContent).toContain("旅行全体 ¥22,100");
    expect(section.textContent).toContain("予算 ¥100,000");
  });

  it("費用の行を押すと編集、「費用を見る」で費用タブへ", () => {
    const { onEditExpense, onShowExpenses } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "うどんの費用を編集" }));
    expect(onEditExpense).toHaveBeenCalledWith(EXPENSES[1]);
    fireEvent.click(screen.getByRole("button", { name: /費用を見る/ }));
    expect(onShowExpenses).toHaveBeenCalled();
  });

  it("その日の経路は、ボタンを押さずに地図をそのまま出す", () => {
    renderPanel();
    const map = screen.getByTitle(/の経路\(地図\)$/);
    expect(map.getAttribute("src")).toContain(encodeURIComponent("東京駅"));
    expect(map.getAttribute("src")).toContain(encodeURIComponent("高松駅"));
    expect(screen.getByRole("button", { name: "場所と移動手段を選ぶ" })).toBeTruthy();
  });

  it("天気は言葉と気温で出す。予報の範囲より先の日は、何も出さない(仕上げ B-2)", () => {
    const weather: TripWeather = {
      status: "ok",
      place: { name: "高松市", latitude: 0, longitude: 0 },
      days: [{ date: DAY1, weatherCode: 0, tempMax: 12, tempMin: 4, precipitationChance: 40 }],
    };
    renderPanel({ weather });
    expect(screen.getByText("降水 40%")).toBeTruthy();
    expect(screen.getByText("高松市の予報")).toBeTruthy();
    cleanup();
    renderPanel({ weather, date: DAY2, dayNumber: 2 });
    expect(screen.queryByText(/より先は、まだ予報が出ていません/)).toBeNull();
    expect(screen.queryByText("高松市の予報")).toBeNull();
    // 日の見出しは残る。
    expect(screen.getByText(/2日目/)).toBeTruthy();
  });

  it("その日の費用が無い日は、そう書く", () => {
    renderPanel({ expenses: [] });
    expect(screen.getByText(/この日の費用はまだありません/)).toBeTruthy();
  });
});
