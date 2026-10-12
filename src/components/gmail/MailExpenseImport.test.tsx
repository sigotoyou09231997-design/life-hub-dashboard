/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SyncedEmail, Transaction } from "../../types";
import { todayStr } from "../../lib/date";
import { ToastProvider } from "../ui/ToastProvider";

const mocks = vi.hoisted(() => ({
  past: [] as Partial<Transaction>[],
  added: [] as Transaction[],
}));

vi.mock("../../db/schema", () => ({
  db: {
    transactions: {
      where: () => ({ equals: () => ({ count: async () => 0 }) }),
      toArray: async () => mocks.past,
      add: async (row: Transaction) => {
        mocks.added.push(row);
        return "new-transaction";
      },
    },
    syncedEmails: { update: async () => 1 },
  },
}));

// 読み取りの中身は自分のテスト(src/lib/expenseMailSuggestion.test.ts)で見る。ここでは決まった結果を返す。
vi.mock("../../lib/expenseMailSuggestion", () => ({
  toExpenseSuggestion: () => ({ amount: 1980, store: "Amazon", date: "2026-10-12" }),
}));

import { MailExpenseImport } from "./MailExpenseImport";

const email = { id: "mail-1", gmailMessageId: "gm-1", subject: "ご注文の確認" } as SyncedEmail;

function renderSheet() {
  return render(
    <ToastProvider>
      <MailExpenseImport email={email} open onClose={() => {}} />
    </ToastProvider>,
  );
}

/** カテゴリ欄のボタンの並び。 */
function categoryButtons(): string[] {
  const field = screen.getByText("カテゴリ").closest(".field") as HTMLElement;
  return within(field)
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

beforeEach(() => {
  mocks.past = [];
  mocks.added = [];
});

afterEach(cleanup);

// iPhone ではシートの中のプルダウンを押すとキーボード(金額の欄)が閉じてシートが動き、選択肢が欄から
// 離れた所に出る(2026-10-12)。収支の入力(ExpenseForm)と同じくボタンにしてある。
describe("メールから支出を作るシートのカテゴリ・支払い方法", () => {
  it("プルダウンではなくボタンで選び、保存される値は今までと同じ", async () => {
    const user = userEvent.setup();
    renderSheet();
    await screen.findByDisplayValue("1980");
    expect(screen.queryByRole("combobox")).toBeNull();
    // 既定は今までどおり「食費」と「クレジットカード」(ボタンの名前は収支の入力と同じ「クレカ」)。
    expect(screen.getByRole("button", { name: "食費" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "クレカ" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "日用品" }));
    await user.click(screen.getByRole("button", { name: "電子マネー" }));
    await user.click(screen.getByRole("button", { name: "支出に追加" }));

    expect(mocks.added[0]).toMatchObject({ amount: 1980, category: "日用品", method: "電子マネー" });
  });

  it("「クレカ」のまま保存すると、今までどおり「クレジットカード」で入る", async () => {
    const user = userEvent.setup();
    renderSheet();
    await screen.findByDisplayValue("1980");
    await user.click(screen.getByRole("button", { name: "支出に追加" }));
    expect(mocks.added[0]).toMatchObject({ category: "食費", method: "クレジットカード" });
  });

  it("カテゴリのボタンは最近よく使う順に並ぶ(選ばれている既定は変えない)", async () => {
    // 数えるのは直近90日だけなので、日付は今日にしておく(いつ走らせても数えられるように)。
    const today = todayStr();
    mocks.past = [
      { type: "expense", category: "娯楽", date: today },
      { type: "expense", category: "娯楽", date: today },
      { type: "expense", category: "日用品", date: today },
    ];
    renderSheet();
    await screen.findByDisplayValue("1980");
    await waitFor(() => expect(categoryButtons().slice(0, 3)).toEqual(["娯楽", "日用品", "食費"]));
    expect(screen.getByRole("button", { name: "食費" }).getAttribute("aria-pressed")).toBe("true");
  });
});
