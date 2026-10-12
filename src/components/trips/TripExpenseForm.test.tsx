/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { TripExpense } from "../../types";
import { TripExpenseForm } from "./TripExpenseForm";
import type { TripExpenseCurrencyDraft } from "../../lib/currency";

const mocks = vi.hoisted(() => ({
  loadCurrencyDraft: vi.fn(),
  fetchRateToYen: vi.fn(),
  saveCurrencyDraft: vi.fn(async () => {}),
  updated: [] as [string, unknown][],
}));

vi.mock("../../db/schema", () => ({
  db: { tripExpenses: { add: async () => "new-row", update: async (id: string, row: unknown) => void mocks.updated.push([id, row]) } },
}));

// レートの判定(needsRateRefetch / isRateFetchable)は本物のまま使い、
// 「読み込み」「取りに行く」「保存」の3つだけ差し替える。
// 保存を本物のままにすると、偽の db に無い tripExpenseCurrencies を引いて
// テストの後ろで落ち、npm test 全体が失敗になる(Unhandled Rejection)。
vi.mock("../../lib/currency", async () => {
  const actual = await vi.importActual<typeof import("../../lib/currency")>("../../lib/currency");
  return {
    ...actual,
    loadCurrencyDraft: mocks.loadCurrencyDraft,
    fetchRateToYen: mocks.fetchRateToYen,
    saveCurrencyDraft: mocks.saveCurrencyDraft,
  };
});

const EXPENSE: TripExpense = {
  id: "e1",
  tripId: "t1",
  title: "夕食",
  amount: 7700,
  category: "meal",
  paid: true,
  createdAt: 0,
};

function renderForm() {
  render(<TripExpenseForm tripId="t1" initial={EXPENSE} onSaved={() => {}} onCancel={() => {}} />);
}

/** ラベルの文字から、その項目の入力欄を引く(補足文もラベルに入るため文字列一致は使わない)。 */
function rateInput(): HTMLInputElement {
  const label = screen.getByText("レート(1通貨あたりの円)", { selector: ".field__label" });
  return label.closest(".field")!.querySelector("input") as HTMLInputElement;
}

function draft(over: Partial<TripExpenseCurrencyDraft>): TripExpenseCurrencyDraft {
  return { currency: "EUR", originalAmount: "45", rate: "", manual: false, ...over };
}

beforeEach(() => {
  mocks.loadCurrencyDraft.mockReset();
  mocks.fetchRateToYen.mockReset();
});
afterEach(cleanup);

/** 2026-09-04の指示: 取得に失敗した費用は、次に編集画面を開いた時に取り直す。 */
describe("開いたときのレート取り直し", () => {
  it("レートが空のまま保存された費用は、開いた時に取りに行って入る", async () => {
    mocks.loadCurrencyDraft.mockResolvedValue(draft({}));
    mocks.fetchRateToYen.mockResolvedValue(171.5);

    renderForm();

    await waitFor(() => expect(rateInput().value).toBe("171.5"));
    expect(mocks.fetchRateToYen).toHaveBeenCalledWith("EUR");
  });

  it("手で入れたレートは取りに行かない(上書きしない)", async () => {
    mocks.loadCurrencyDraft.mockResolvedValue(draft({ rate: "160", manual: true }));

    renderForm();

    await waitFor(() => expect(rateInput().value).toBe("160"));
    expect(mocks.fetchRateToYen).not.toHaveBeenCalled();
  });

  it("すでにレートが入っている費用も、取りに行かない", async () => {
    mocks.loadCurrencyDraft.mockResolvedValue(draft({ rate: "171.5" }));

    renderForm();

    await waitFor(() => expect(rateInput().value).toBe("171.5"));
    expect(mocks.fetchRateToYen).not.toHaveBeenCalled();
  });

  it("取り直しても駄目なら、手で入れてもらう案内を出す", async () => {
    mocks.loadCurrencyDraft.mockResolvedValue(draft({}));
    mocks.fetchRateToYen.mockResolvedValue(undefined);

    renderForm();

    await waitFor(() => {
      expect(screen.getByText("レートを取れませんでした。手で入れてください。")).toBeTruthy();
    });
    expect(rateInput().value).toBe("");
  });
});

describe("費用の入力: 支払った人", () => {
  it("参加者がいれば支払った人を選べて、保存に入る。参加者から外した人の名前も残す", async () => {
    mocks.loadCurrencyDraft.mockResolvedValue({ currency: "JPY", originalAmount: "", rate: "", manual: false });
    mocks.updated = [];
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    render(
      <TripExpenseForm tripId="t1" initial={{ ...EXPENSE, paidBy: "抜けた人" }} members={["ふなだ", "えっくん"]} onSaved={() => {}} onCancel={() => {}} />,
    );
    // 支払った人は分けたボタン(シートの中のプルダウンは iPhone で選択肢が離れて出るため、2026-10-12)。
    const payers = ["決めていない", "ふなだ", "えっくん", "抜けた人"].map((name) => screen.getByRole("button", { name }));
    expect(payers.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "true"]);
    await user.click(screen.getByRole("button", { name: "えっくん" }));
    await user.click(screen.getByRole("button", { name: /保存/ }));
    await waitFor(() => expect(mocks.updated[0]?.[1]).toMatchObject({ paidBy: "えっくん" }));
  });

  it("参加者の列が null(同期で降りてきた、参加者を入れていない旅行)でも開ける", () => {
    mocks.loadCurrencyDraft.mockResolvedValue({ currency: "JPY", originalAmount: "", rate: "", manual: false });
    render(<TripExpenseForm tripId="t1" initial={EXPENSE} members={null} onSaved={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("button", { name: "決めていない" })).toBeNull();
    expect(screen.getByRole("button", { name: /保存/ })).toBeTruthy();
  });

  it("参加者がいなければ、支払った人の欄は出さない", () => {
    mocks.loadCurrencyDraft.mockResolvedValue({ currency: "JPY", originalAmount: "", rate: "", manual: false });
    renderForm();
    expect(screen.queryByRole("button", { name: "決めていない" })).toBeNull();
  });
});

