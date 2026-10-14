/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TripExpense } from "../../types";
import { ConfirmProvider } from "../ui/ConfirmProvider";
import { TripExpenseList } from "./TripExpenseList";

afterEach(cleanup);

function expense(id: string, amount: number, paidBy?: string): TripExpense {
  return { id, tripId: "t", title: `費用${id}`, amount, category: "other", paid: true, paidBy, createdAt: 0 };
}

function renderList(expenses: TripExpense[], members?: string[], extra: Partial<React.ComponentProps<typeof TripExpenseList>> = {}) {
  render(<TripExpenseList expenses={expenses} members={members} onEdit={() => {}} onDelete={() => {}} {...extra} />, { wrapper: ConfirmProvider });
}

/** 「割り勘」のタブを開く(2026-10-14、要望「支払いのところに割り勘タブがほしい」)。 */
function openSplitTab() {
  fireEvent.click(screen.getByRole("tab", { name: "割り勘" }));
}

describe("費用の一覧: 支払った人と割り勘", () => {
  it("支払った人を、費用ごとに出す", () => {
    renderList([expense("1", 17000, "えっくん")]);
    expect(screen.getByText("えっくんが支払い")).toBeTruthy();
  });

  it("参加者が2人以上なら、払った額と、受け取る/払う差額を出す", () => {
    renderList([expense("1", 17000, "えっくん"), expense("2", 3000, "ふなだ"), expense("3", 4000)], ["ふなだ", "えっくん"]);
    openSplitTab();
    const split = screen.getByLabelText("割り勘");
    expect(split.textContent).toContain("2人・1人あたり ¥10,000");
    expect(split.textContent).toContain("¥7,000 払う");
    expect(split.textContent).toContain("¥7,000 受け取る");
    expect(split.textContent).toContain("誰が払ったか決まっていない費用 ¥4,000 は、割り勘に入れていません");
  });

  it("誰が払ったかがまだ1つも無ければ、入れ方だけ知らせる", () => {
    renderList([expense("1", 4000)], ["ふなだ", "えっくん"]);
    openSplitTab();
    const split = screen.getByLabelText("割り勘");
    expect(split.textContent).toContain("「支払った人」を入れると");
    expect(split.textContent).not.toContain("払う");
  });

  it("参加者が1人以下なら、割り勘の計算は出さず、参加者の入れ方を知らせる", () => {
    renderList([expense("1", 1000, "a")], ["a"]);
    openSplitTab();
    expect(screen.getByLabelText("割り勘").textContent).toContain("参加者がまだ1人です");
    expect(screen.queryByLabelText("精算の仕方")).toBeNull();
  });
});

describe("費用の「割り勘」タブ(2026-10-14)", () => {
  it("費用のタブの中に「費用」と「割り勘」の切り替えがあり、初めは費用の一覧。割り勘の中身は、割り勘のタブを開くまで出ない", () => {
    renderList([expense("1", 17000, "えっくん")], ["ふなだ", "えっくん"]);
    expect(screen.getByRole("tab", { name: "費用" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("支出合計")).toBeTruthy();
    expect(screen.queryByLabelText("割り勘")).toBeNull();
    openSplitTab();
    expect(screen.getByRole("tab", { name: "割り勘" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("割り勘")).toBeTruthy();
    // 割り勘のタブには、費用の一覧(予算・合計)は出さない。費用に戻せる。
    expect(screen.queryByText("支出合計")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "費用" }));
    expect(screen.getByText("支出合計")).toBeTruthy();
  });

  it("参加者がまだ無い旅行でも、割り勘のタブはある。参加者の入れ方と、入れる画面を開くボタンを出す", () => {
    const onEditMembers = vi.fn();
    renderList([expense("1", 1000)], undefined, { onEditMembers });
    openSplitTab();
    expect(screen.getByLabelText("割り勘").textContent).toContain("参加者を2人以上入れると");
    fireEvent.click(screen.getByRole("button", { name: "参加者を入れる" }));
    expect(onEditMembers).toHaveBeenCalledTimes(1);
  });

  it("精算の仕方: 払う人が受け取る人へ、いくら渡せばいいかを出す。差額が無ければ「必要ありません」", () => {
    renderList([expense("1", 17000, "えっくん"), expense("2", 3000, "ふなだ")], ["ふなだ", "えっくん"]);
    openSplitTab();
    const settle = screen.getByLabelText("精算の仕方");
    expect(settle.textContent).toContain("ふなだ → えっくん");
    expect(settle.textContent).toContain("¥7,000");

    cleanup();
    renderList([expense("1", 5000, "えっくん"), expense("2", 5000, "ふなだ")], ["ふなだ", "えっくん"]);
    openSplitTab();
    expect(screen.getByLabelText("精算の仕方").textContent).toContain("精算の必要はありません");
  });

  it("支払った人が決まっていない費用を一覧にして、押すとその費用の編集を開く", () => {
    const onEdit = vi.fn();
    const unassigned = expense("3", 4000);
    renderList([expense("1", 17000, "えっくん"), expense("2", 3000, "ふなだ"), unassigned], ["ふなだ", "えっくん"], { onEdit });
    openSplitTab();
    const box = screen.getByLabelText("支払った人が決まっていない費用");
    expect(box.textContent).toContain("費用3");
    expect(box.textContent).toContain("¥4,000");
    fireEvent.click(screen.getByRole("button", { name: "費用3を編集" }));
    expect(onEdit).toHaveBeenCalledWith(unassigned);
  });
});
