/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../lib/currency", () => ({ fetchRateToYen: async () => 157.95 }));
vi.mock("../../lib/gmail", () => ({}));

const { ClaudePriceHint } = await import("./ClaudePriceHint");

beforeEach(() => {
  window.localStorage.setItem(
    "lifeHubAnthropicBilling",
    JSON.stringify({
      receipts: [{ messageId: "m1", receiptNo: "2772-7138-4270", paidOn: "2026-10-19", total: 110, tax: 10, kind: "subscription", label: "Claude Max 5x" }],
      failed: [],
      fetchedAt: 1,
    }),
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Claude の請求の内訳", () => {
  it("登録の金額(実際の引き落とし ¥17,980)を、ドルの税抜・消費税の割合で分けて出す", async () => {
    render(<ClaudePriceHint amount="17980" serviceKey="claude-max" />);
    expect(await screen.findByText(/今日の為替/)).toBeTruthy();
    expect(screen.getByText("¥17,980")).toBeTruthy();
    expect(screen.getByText("¥16,345")).toBeTruthy();
    expect(screen.getByText("¥1,635")).toBeTruthy();
    expect(screen.getByText("$110.00")).toBeTruthy();
    expect(screen.getByText(/10\/19 の領収書・Max 5x/)).toBeTruthy();
  });

  it("1ドルあたりの値段と、為替だけの額・その差(カードの手数料など)を並べる", async () => {
    render(<ClaudePriceHint amount="17980" serviceKey="claude-max" />);
    const note = await screen.findByText(/今日の為替/);
    expect(note.textContent).toContain("1ドルあたり 163.45円");
    expect(note.textContent).toContain("今日の為替（1ドル157.95円）だけで計算すると ¥17,375");
    expect(note.textContent).toContain("差の 3.5% はカード会社の換算や海外利用の手数料");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("登録の金額が為替だけの額より安ければ(古い金額のまま)、明細の額に直すよう知らせる", async () => {
    render(<ClaudePriceHint amount="16500" serviceKey="claude-max" />);
    expect((await screen.findByRole("note")).textContent).toContain("為替だけで計算した額（¥17,375）より安く");
  });

  it("領収書もプランも無い時は、入れた金額を税込として税抜を出す", () => {
    window.localStorage.clear();
    render(<ClaudePriceHint amount="17980" serviceKey={null} />);
    expect(screen.getByText("入れた金額を税込とすると、税抜 ¥16,345・消費税 ¥1,635 です。")).toBeTruthy();
  });
});
