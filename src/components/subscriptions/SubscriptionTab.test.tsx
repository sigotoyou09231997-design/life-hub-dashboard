// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

import { SubscriptionTab } from "./SubscriptionTab";

function cost(id: string, over: Partial<FixedCost>): FixedCost {
  return { id, title: id, category: "動画", amount: 1_000, dueDay: 1, active: true, ...over };
}

function renderTab() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <SubscriptionTab />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T09:00:00"));
  localStorage.clear();
  mocks.costs = [
    cost("n", { title: "Netflix", amount: 1_590, dueDay: 20 }),
    cost("s", { title: "Spotify", category: "音楽", amount: 1_080, dueDay: 13 }),
    cost("p", { title: "Amazonプライム", category: "買い物", amount: 6_000, dueDay: 15 }),
    cost("u", { title: "U-NEXT", amount: 2_189, dueDay: 30 }),
    cost("h", { title: "Hulu", amount: 1_320, dueDay: 1, active: false }),
  ];
  mocks.details = [
    { fixedCostId: "p", cycle: "yearly", billingMonth: 4, createdAt: 0 },
    { fixedCostId: "u", cycle: "monthly", trialEndDate: "2026-10-30", createdAt: 0 },
    { fixedCostId: "h", cycle: "monthly", cancelledAt: "2026-08-15", createdAt: 0 },
  ];
  mocks.saved = [];
  mocks.cancelled = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("お金管理のサブスクタブ", () => {
  it("合計は請求が続いているものだけ。年払いは月あたりに直し、年額に切り替えられる", async () => {
    renderTab();
    // 1,590 + 1,080 + 6,000/12 = 3,170
    expect(await screen.findByText("¥3,170")).toBeTruthy();
    expect(screen.getByText(/年払い1件は月あたりに直して合計/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "年額" }));
    // (1,590 + 1,080) × 12 + 6,000 = 38,040
    expect(screen.getByText("¥38,040")).toBeTruthy();
  });

  it("契約中は次の請求が近い順で、残り日数が出る。無料体験と解約済みは別に並ぶ", async () => {
    renderTab();
    const rows = await screen.findAllByRole("button", { name: /を開く$/ });
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Spotifyを開く",
      "Netflixを開く",
      "Amazonプライムを開く",
      "U-NEXTを開く",
    ]);
    expect(within(rows[0]).getByText("明日")).toBeTruthy();
    expect(within(rows[1]).getByText("あと8日")).toBeTruthy();
    expect(screen.getByText("無料体験中")).toBeTruthy();
    expect(within(rows[3]).getByText(/無料体験/)).toBeTruthy();

    // 解約済みは畳んである。開くと出る。
    expect(screen.queryByRole("button", { name: "Huluを開く" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /解約済み/ }));
    expect(screen.getByRole("button", { name: "Huluを開く" })).toBeTruthy();
  });

  it("人気サービスから選ぶと、名前・料金・払い方が入った状態で追加できる", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /サブスクを追加/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Netflix\s*¥/ }));
    fireEvent.click(screen.getByRole("button", { name: /スタンダード.*1,590/ }));

    expect((screen.getByLabelText("名前") as HTMLInputElement).value).toBe("Netflix");
    expect((screen.getByLabelText(/毎月の金額/) as HTMLInputElement).value).toBe("1590");
    fireEvent.click(screen.getByRole("button", { name: "追加する" }));

    await waitFor(() => expect(mocks.saved).toHaveLength(1));
    const [record, detail] = mocks.saved[0] as [FixedCost, Partial<SubscriptionDetail>];
    expect(record).toMatchObject({ title: "Netflix", amount: 1_590, category: "動画", active: true });
    expect(detail).toMatchObject({ cycle: "monthly", serviceKey: "netflix-standard", cancelledAt: null });
  });

  it("編集シートから解約を記録できる", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Netflixを開く" }));
    fireEvent.click(screen.getByRole("button", { name: /解約する/ }));
    fireEvent.click(screen.getByRole("button", { name: "この日で解約する" }));
    await waitFor(() => expect(mocks.cancelled).toHaveLength(1));
    expect(mocks.cancelled[0][1]).toBe("2026-10-12");
  });

  it("分析: カテゴリごとの金額と割合を一覧に出す(色だけに頼らない)", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("tab", { name: "分析" }));
    expect(screen.getByRole("img", { name: "カテゴリ別の割合" })).toBeTruthy();
    const video = screen.getByRole("button", { name: /動画/ });
    expect(within(video).getByText("¥1,590")).toBeTruthy();
    // 解約したHulu: 9/1・10/1 の2回ぶん浮いた
    expect(screen.getByText("¥2,640")).toBeTruthy();
  });

  it("分析: 家賃があると、最初はサブスクだけで見せ、切り替えると家賃も入る", async () => {
    mocks.costs.push(cost("r", { title: "家賃", category: "家賃", amount: 78_000, dueDay: 27 }));
    renderTab();
    fireEvent.click(await screen.findByRole("tab", { name: "分析" }));
    expect(screen.getByText("サブスク合計")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^家賃\s*1件/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "家賃なども含める" }));
    expect(screen.getByRole("button", { name: /^家賃\s*1件/ })).toBeTruthy();
  });

  it("カレンダー: その月の請求を日付順に並べる", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("tab", { name: "カレンダー" }));
    // 10月: Spotify 13日・Netflix 20日・U-NEXT 30日(体験おわり)。年払いの Amazon は4月なので出ない。
    expect(screen.getByText(/この月の請求 ¥4,859/)).toBeTruthy();
    expect(screen.getByText(/無料体験おわり/)).toBeTruthy();
  });
});
