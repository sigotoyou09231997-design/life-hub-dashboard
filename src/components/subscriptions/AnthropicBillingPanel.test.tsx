/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { AnthropicReceipt, BillingData } from "../../lib/anthropicBilling";

const mocks = vi.hoisted(() => ({
  accounts: [] as unknown[],
  refresh: vi.fn(),
}));

vi.mock("../../db/schema", () => ({ db: { gmailAccounts: { toArray: async () => mocks.accounts } } }));
vi.mock("dexie-react-hooks", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useLiveQuery: (querier: () => unknown) => {
      const [value, setValue] = useState<unknown>(undefined);
      useEffect(() => {
        let active = true;
        void Promise.resolve(querier()).then((next) => active && setValue(next));
        return () => {
          active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return value;
    },
  };
});
vi.mock("../../lib/anthropicBilling", async () => {
  const actual = await vi.importActual<typeof import("../../lib/anthropicBilling")>("../../lib/anthropicBilling");
  return { ...actual, refreshBilling: mocks.refresh };
});

import { AnthropicBillingPanel } from "./AnthropicBillingPanel";

const receipt = (over: Partial<AnthropicReceipt> & { receiptNo: string }): AnthropicReceipt => ({
  messageId: over.receiptNo,
  paidOn: "2026-09-19",
  total: 110,
  tax: 10,
  kind: "subscription",
  label: "Claude Max 5x",
  ...over,
});

const STORED: BillingData = {
  receipts: [
    receipt({ receiptNo: "1", paidOn: "2026-09-19", total: 110, kind: "subscription" }),
    receipt({ receiptNo: "2", paidOn: "2026-09-21", total: 11.04, kind: "credit", label: "クレジットの自動補充" }),
    receipt({ receiptNo: "3", paidOn: "2026-08-19", total: 109.23, kind: "subscription" }),
  ],
  failed: [{ messageId: "f", on: "2026-10-07", amount: 11.02 }],
  fetchedAt: Date.now() - 60_000,
};

function renderPanel() {
  render(
    <MemoryRouter>
      <AnthropicBillingPanel />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.accounts = [];
  mocks.refresh.mockReset();
});
afterEach(cleanup);

describe("AnthropicBillingPanel(Claude の枠の、Anthropic の料金)", () => {
  it("覚えてある集計を、月ごとに出す。サブスクと追加(APIクレジット)を分け、円とドルの両方を添える", () => {
    window.localStorage.setItem("lifeHubAnthropicBilling", JSON.stringify(STORED));
    renderPanel();
    const list = screen.getByRole("list");
    const rows = list.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    // 新しい月が先。
    expect(rows[0].textContent).toContain("2026年9月");
    expect(rows[0].textContent).toContain("¥18,156");
    expect(rows[0].textContent).toContain("$121.04");
    expect(rows[0].textContent).toContain("サブスク ¥16,500");
    expect(rows[0].textContent).toContain("追加（APIクレジット）¥1,656");
    expect(rows[1].textContent).toContain("2026年8月");
    expect(rows[1].textContent).toContain("¥16,385");
    expect(screen.getByText(/2か月の合計/).textContent).toContain("¥34,541");
    expect(screen.getByText(/1ドル150円の目安/)).toBeTruthy();
  });

  it("支払いに失敗した通知があれば、赤い知らせで出す", () => {
    window.localStorage.setItem("lifeHubAnthropicBilling", JSON.stringify(STORED));
    renderPanel();
    expect(screen.getByRole("alert").textContent).toContain("10/7 に $11.02 の支払いに失敗しました");
  });

  it("Gmail がつながっていなければ、読み込みボタンは出さず、つなぐ案内を出す(覚えてある集計は見える)", () => {
    window.localStorage.setItem("lifeHubAnthropicBilling", JSON.stringify(STORED));
    renderPanel();
    expect(screen.queryByRole("button", { name: /領収書を読み込む/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Gmail をつなぐ" }).getAttribute("href")).toBe("/gmail");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("Gmail がつながっていて、まだ一度も読んでいなければ、開いた時に自動で読み込む", async () => {
    mocks.accounts = [{ id: "a1", email: "me@example.com" }];
    mocks.refresh.mockResolvedValue({ ...STORED, fetchedAt: Date.now(), added: 3, unreadable: 0 });
    renderPanel();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("新しい領収書を3件読み込みました")).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBe(2);
  });

  it("読んだばかり(12時間以内)なら、自動では読み直さない。ボタンを押した時だけ読み込む", async () => {
    window.localStorage.setItem("lifeHubAnthropicBilling", JSON.stringify(STORED));
    mocks.accounts = [{ id: "a1", email: "me@example.com" }];
    mocks.refresh.mockResolvedValue({ ...STORED, fetchedAt: Date.now(), added: 0, unreadable: 0 });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("button", { name: /領収書を読み込む/ });
    expect(mocks.refresh).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /領収書を読み込む/ }));
    expect(await screen.findByText("新しい領収書はありませんでした")).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("領収書が1通も無ければ、そう言う。読み込みに失敗した時は、理由を出す(覚えてある集計は消さない)", async () => {
    mocks.accounts = [{ id: "a1", email: "me@example.com" }];
    mocks.refresh.mockResolvedValueOnce({ receipts: [], failed: [], fetchedAt: Date.now(), added: 0, unreadable: 0 });
    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByText("Anthropic の領収書は見つかりませんでした")).toBeTruthy();

    mocks.refresh.mockRejectedValueOnce(new Error("Gmail API error (401)"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: /領収書を読み込む/ }));
    expect((await screen.findAllByRole("alert"))[0].textContent).toContain("Gmail から読み込めませんでした");
    spy.mockRestore();
  });
});
