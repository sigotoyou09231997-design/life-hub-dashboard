/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TripExpense } from "../../types";
import { ConfirmProvider } from "../ui/ConfirmProvider";
import { TripExpenseList } from "./TripExpenseList";

afterEach(cleanup);

function expense(id: string, amount: number, paidBy?: string): TripExpense {
  return { id, tripId: "t", title: `費用${id}`, amount, category: "other", paid: true, paidBy, createdAt: 0 };
}

function renderList(expenses: TripExpense[], members?: string[]) {
  render(<TripExpenseList expenses={expenses} members={members} onEdit={() => {}} onDelete={() => {}} />, { wrapper: ConfirmProvider });
}

describe("費用の一覧: 支払った人と割り勘", () => {
  it("支払った人を、費用ごとに出す", () => {
    renderList([expense("1", 17000, "えっくん")]);
    expect(screen.getByText("えっくんが支払い")).toBeTruthy();
  });

  it("参加者が2人以上なら、払った額と、受け取る/払う差額を出す", () => {
    renderList([expense("1", 17000, "えっくん"), expense("2", 3000, "ふなだ"), expense("3", 4000)], ["ふなだ", "えっくん"]);
    const split = screen.getByLabelText("割り勘");
    expect(split.textContent).toContain("2人・1人あたり ¥10,000");
    expect(split.textContent).toContain("¥7,000 払う");
    expect(split.textContent).toContain("¥7,000 受け取る");
    expect(split.textContent).toContain("誰が払ったか決まっていない費用 ¥4,000 は、割り勘に入れていません");
  });

  it("誰が払ったかがまだ1つも無ければ、入れ方だけ知らせる", () => {
    renderList([expense("1", 4000)], ["ふなだ", "えっくん"]);
    const split = screen.getByLabelText("割り勘");
    expect(split.textContent).toContain("「支払った人」を入れると");
    expect(split.textContent).not.toContain("払う");
  });

  it("参加者が1人以下なら、割り勘の欄は出さない", () => {
    renderList([expense("1", 1000, "a")], ["a"]);
    expect(screen.queryByLabelText("割り勘")).toBeNull();
  });
});
