/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
  it("領収書の税抜・消費税・税込を、その日の為替で円にして出す", async () => {
    render(<ClaudePriceHint amount="16500" serviceKey="claude-max" onUse={() => {}} />);
    expect(await screen.findByText("¥17,375")).toBeTruthy();
    expect(screen.getByText("¥15,795")).toBeTruthy();
    expect(screen.getByText("¥1,580")).toBeTruthy();
    expect(screen.getByText(/10\/19 の領収書・Max 5x/)).toBeTruthy();
    expect(screen.getByText(/1ドル157\.95円（今日の為替）/)).toBeTruthy();
  });

  it("登録の金額が請求と違えば、そろえるボタンを出し、押すと税込の円を渡す", async () => {
    const onUse = vi.fn();
    render(<ClaudePriceHint amount="16500" serviceKey="claude-max" onUse={onUse} />);
    fireEvent.click(await screen.findByRole("button", { name: "金額を ¥17,375（税込）にする" }));
    expect(onUse).toHaveBeenCalledWith(17375);
  });

  it("同じ金額や、為替の動きくらいの差(3%以内)なら、ボタンは出さない", async () => {
    render(<ClaudePriceHint amount="17600" serviceKey="claude-max" onUse={() => {}} />);
    await screen.findByText(/今日の為替/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("領収書もプランも無い時は、入れた金額を税込として税抜を出す", () => {
    window.localStorage.clear();
    render(<ClaudePriceHint amount="17375" serviceKey={null} onUse={() => {}} />);
    expect(screen.getByText("入れた金額を税込とすると、税抜 ¥15,795・消費税 ¥1,580 です。")).toBeTruthy();
  });
});
