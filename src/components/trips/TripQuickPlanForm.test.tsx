/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TripExpense, TripRoutePlace, TripScheduleItem } from "../../types";
import { TripQuickPlanForm } from "./TripQuickPlanForm";

const added = { schedule: [] as TripScheduleItem[], expense: [] as TripExpense[], route: [] as TripRoutePlace[] };

vi.mock("../../db/schema", () => ({
  db: {
    tripSchedule: { add: async (row: TripScheduleItem) => void added.schedule.push(row) },
    tripExpenses: { add: async (row: TripExpense) => void added.expense.push(row) },
    tripRoutePlaces: { add: async (row: TripRoutePlace) => void added.route.push(row) },
  },
}));

/** 項目の入力欄を見出しから引く。
 *
 * Field(src/components/ui/Field.tsx)は1つの <label> の中に見出し・入力・補足を
 * 並べるので、label 全体の文字列は「場所任意ルートにも入れるときは…」のように
 * 続いてしまう。見出しそのものが一致する項目から辿る。 */
function field(label: string): HTMLElement {
  const head = screen.getByText(label, { selector: ".field__label" });
  const input = head.closest("label")?.querySelector("input, textarea, select");
  if (!input) throw new Error(`「${label}」の入力欄が見つかりません`);
  return input as HTMLElement;
}

function renderForm(onSaved: (message: string) => void = () => {}, existing: string[] = []) {
  render(
    <TripQuickPlanForm
      tripId="t1"
      defaultDate="2026-09-19"
      nextSortOrder={4}
      existingRouteKeys={new Set(existing)}
      onSaved={onSaved}
      onCancel={() => {}}
    />,
  );
}

afterEach(() => {
  cleanup();
  added.schedule = [];
  added.expense = [];
  added.route = [];
});

describe("まとめて追加のフォーム", () => {
  it("1回の入力で、日程・費用・ルートの3件が入る", async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    renderForm(saved);

    await user.type(field("タイトル"), "五稜郭");
    await user.type(field("場所"), "北海道函館市五稜郭町44");
    await user.click(screen.getByRole("switch", { name: /費用にも入れる/ }));
    await user.type(field("金額"), "1200");
    await user.click(screen.getByRole("switch", { name: /ルートにも入れる/ }));
    await user.click(screen.getByRole("button", { name: "まとめて追加" }));

    expect(added.schedule).toHaveLength(1);
    expect(added.schedule[0]).toMatchObject({ title: "五稜郭", date: "2026-09-19", location: "北海道函館市五稜郭町44" });
    expect(added.expense[0]).toMatchObject({ title: "五稜郭", amount: 1200, category: "sightseeing", paidDate: "2026-09-19" });
    // 名前も住所も空欄のままなら、上の入力をそのまま引き継ぐ。
    expect(added.route[0]).toMatchObject({ name: "五稜郭", address: "北海道函館市五稜郭町44", sortOrder: 4, date: "2026-09-19" });
    expect(saved).toHaveBeenCalledWith("日程・費用・ルートに入れました");
  });

  it("スイッチを触らなければ、日程だけが増える", async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    renderForm(saved);

    await user.type(field("タイトル"), "朝市");
    await user.click(screen.getByRole("button", { name: "まとめて追加" }));

    expect(added.schedule).toHaveLength(1);
    expect(added.expense).toHaveLength(0);
    expect(added.route).toHaveLength(0);
    expect(saved).toHaveBeenCalledWith("日程に入れました");
  });

  it("金額を入れずに費用を入れようとすると、保存せずに知らせる", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(field("タイトル"), "五稜郭");
    await user.click(screen.getByRole("switch", { name: /費用にも入れる/ }));
    await user.click(screen.getByRole("button", { name: "まとめて追加" }));

    expect(screen.getByText("金額を入れてください")).toBeTruthy();
    expect(added.schedule).toHaveLength(0);
  });

  it("種類を変えると、費用の分類もついてくる", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(field("タイトル"), "はやぶさ13号");
    await user.selectOptions(field("種類"), "transport");
    await user.click(screen.getByRole("switch", { name: /費用にも入れる/ }));
    await user.type(field("金額"), "23000");
    await user.click(screen.getByRole("button", { name: "まとめて追加" }));

    expect(added.expense[0].category).toBe("transport");
  });
});
