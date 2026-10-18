/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TripAgendaGroups } from "./TripAgendaGroups";
import type { TripAgendaEntry } from "./TripAgendaList";

afterEach(cleanup);

const ITEMS: TripAgendaEntry[] = [
  { id: "a", tripId: "t1", tripName: "四国・小豆島旅行", date: "2026-12-27", startTime: "05:00", title: "起床" },
  { id: "b", tripId: "t1", tripName: "四国・小豆島旅行", date: "2026-12-27", startTime: "05:30", title: "自宅出発" },
  { id: "c", tripId: "t1", tripName: "四国・小豆島旅行", date: "2026-12-28", startTime: "10:00", title: "屋島を歩く" },
  { id: "d", tripId: "t2", tripName: "冬の温泉", date: "2027-01-10", title: "出発" },
];

function renderGroups(props: Partial<Parameters<typeof TripAgendaGroups>[0]> = {}) {
  return render(
    <MemoryRouter>
      <TripAgendaGroups items={ITEMS} {...props} />
    </MemoryRouter>,
  );
}

describe("一覧タブの「今後の旅行の予定」は旅行ごとに1行(第8弾 S-3)", () => {
  it("旅行名・期間・件数の1行にまとめ、中身の日程は出さない", () => {
    renderGroups();
    const head = screen.getByRole("button", { name: /四国・小豆島旅行/ });
    expect(head.textContent).toContain("12/27(日) 〜 12/28(月)");
    expect(head.textContent).toContain("3件");
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("起床")).toBeNull();
    expect(screen.getByRole("button", { name: /冬の温泉/ }).textContent).toContain("1件");
  });

  it("押すと日ごとに開き、もう一度押すと畳む", () => {
    renderGroups();
    const head = screen.getByRole("button", { name: /四国・小豆島旅行/ });
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("起床")).toBeTruthy();
    expect(screen.getByText("屋島を歩く")).toBeTruthy();
    expect(screen.getByText(/12月27日/)).toBeTruthy();
    fireEvent.click(head);
    expect(screen.queryByText("起床")).toBeNull();
  });

  it("検索中(forceOpen)は、中身がそのまま出る", () => {
    renderGroups({ forceOpen: true });
    expect(screen.getByText("自宅出発")).toBeTruthy();
  });
});
