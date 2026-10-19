// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FixedCost, SubscriptionDetail } from "../../types";
import { ToastProvider } from "../ui/ToastProvider";
import { ConfirmProvider } from "../ui/ConfirmProvider";

const mocks = vi.hoisted(() => ({
  costs: [] as FixedCost[],
  details: [] as SubscriptionDetail[],
  saved: [] as unknown[][],
  cancelled: [] as unknown[][],
}));

vi.mock("../../db/schema", () => ({
  db: {
    fixedCosts: { toArray: async () => mocks.costs },
    subscriptionDetails: { toArray: async () => mocks.details },
    fixedCostAmountChanges: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
  },
}));

vi.mock("../../lib/subscriptionStore", () => ({
  saveSubscription: async (...args: unknown[]) => void mocks.saved.push(args),
  cancelSubscription: async (...args: unknown[]) => void mocks.cancelled.push(args),
  resumeSubscription: async () => {},
  duplicateSubscription: async () => "copy",
  deleteSubscription: async () => {},
}));

// useLiveQuery は本物のDexieテーブルを相手にしないと値を返さないので、問い合わせを
// 1回実行するだけの最小版に差し替える(EventScanForm.test.tsx と同じ)。
vi.mock("dexie-react-hooks", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useLiveQuery: (querier: () => unknown, deps: unknown[] = []) => {
      const [value, setValue] = useState<unknown>(undefined);
      useEffect(() => {
        let active = true;
        void Promise.resolve(querier()).then((next) => {
          if (active) setValue(next);
        });
        return () => {
          active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
      return value;
    },
  };
});

const budget = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../../hooks/usePayPeriodBudget", () => ({ usePayPeriodBudget: () => ({ data: budget.value, loading: false }) }));

import { FixedCostTab } from "./FixedCostTab";

function cost(id: string, over: Partial<FixedCost>): FixedCost {
  return { id, title: id, category: "家賃", amount: 1_000, dueDay: 1, active: true, ...over };
}

function renderTab() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <FixedCostTab />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T09:00:00"));
  mocks.costs = [
    cost("rent", { title: "家賃", amount: 70_000, dueDay: 27 }),
    cost("power", { title: "電気代", category: "水道光熱費", amount: 8_000, dueDay: 5 }),
    cost("car", { title: "自動車保険", category: "保険", amount: 36_000, dueDay: 10 }),
    cost("netflix", { title: "Netflix", category: "動画", amount: 1_590, dueDay: 20 }),
  ];
  mocks.details = [{ fixedCostId: "car", cycle: "yearly", billingMonth: 11, createdAt: 0 }];
  mocks.saved = [];
  budget.value = {
    period: { periodStart: new Date(2026, 8, 25), salaryAmount: 262_000, hasSalaryForPeriod: true, daysUntilNextPayday: 5 },
    totalFixedCosts: 79_590,
    fixedExpenseTotal: 78_000,
    subscriptionTotal: 1_590,
    actualSpending: 32_270,
    pendingCardSpending: 0,
    bonusAmount: 0,
    remaining: 150_140,
    perDayUsable: 30_028,
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("お金管理の固定費タブ", () => {
  it("家賃・光熱費・保険だけを、毎月のものは支払日の順、年に1回のものはその後に並べる(サブスクは出さない)", async () => {
    renderTab();
    const rows = await screen.findAllByRole("button", { name: /を開く$/ });
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["電気代を開く", "家賃を開く", "自動車保険を開く"]);
    expect(screen.queryByRole("button", { name: "Netflixを開く" })).toBeNull();
    // 毎月の固定費: 8,000 + 70,000 + 年36,000/12
    expect(screen.getByText("毎月の固定費").parentElement?.textContent).toContain("¥81,000");
  });

  it("給与から、固定費・サブスク・使った額を引いた残りを出す(使えるお金と同じ数字)", async () => {
    renderTab();
    const box = await screen.findByRole("region", { name: "給与からの引き方" });
    const text = box.textContent ?? "";
    expect(text).toContain("¥262,000");
    expect(text).toContain("固定費−¥78,000");
    expect(text).toContain("サブスク−¥1,590");
    expect(text).toContain("使った額−¥32,270");
    expect(text).toContain("残り（使えるお金）¥150,140");
  });

  it("今の期間の給与が無い時は、給与を登録するよう書く", async () => {
    budget.value = null;
    renderTab();
    expect(await screen.findByText(/「給与」のタブで登録すると/)).toBeTruthy();
  });

  it("固定費が1件も無ければ、追加のボタンだけの空の表示", async () => {
    mocks.costs = [cost("netflix", { title: "Netflix", category: "動画" })];
    renderTab();
    expect(await screen.findByText("固定費はまだありません")).toBeTruthy();
  });

  it("追加のフォームは、種類を固定費のものから選び、保存すると固定費として残る", async () => {
    renderTab();
    fireEvent.click((await screen.findAllByRole("button", { name: /固定費を追加/ }))[0]);
    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "ガス代" } });
    fireEvent.click(screen.getByRole("button", { name: "水道光熱費" }));
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "4500" } });
    fireEvent.click(screen.getByRole("button", { name: "追加する" }));
    await waitFor(() => expect(mocks.saved).toHaveLength(1));
    expect(mocks.saved[0][0]).toMatchObject({ title: "ガス代", category: "水道光熱費", amount: 4500 });
    expect(screen.queryByRole("button", { name: "動画" })).toBeNull();
  });
});
