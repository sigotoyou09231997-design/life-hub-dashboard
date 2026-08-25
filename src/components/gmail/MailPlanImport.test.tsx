/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmailAccount, SyncedEmail } from "../../types";
import { ToastProvider } from "../ui/ToastProvider";

const mocks = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  extractError: null as Error | null,
  trips: [] as Record<string, unknown>[],
  saved: {
    tripSchedule: [] as unknown[],
    tripExpenses: [] as unknown[],
    calendarEvents: [] as unknown[],
    tasks: [] as unknown[],
  },
}));

vi.mock("../../db/schema", () => ({
  db: {
    trips: { toArray: async () => mocks.trips },
    tripSchedule: { add: async (row: unknown) => void mocks.saved.tripSchedule.push(row) },
    tripExpenses: { add: async (row: unknown) => void mocks.saved.tripExpenses.push(row) },
    calendarEvents: { add: async (row: unknown) => void mocks.saved.calendarEvents.push(row) },
    tasks: { add: async (row: unknown) => void mocks.saved.tasks.push(row) },
  },
}));
// useLiveQuery は本物のDexieテーブルを相手にしないと値を返さない。ここで見たいのは
// 画面の組み立てなので、問い合わせ関数を1回実行するだけの最小版に差し替える。
vi.mock("dexie-react-hooks", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useLiveQuery: (querier: () => unknown) => {
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
      }, []);
      return value;
    },
  };
});
vi.mock("../../lib/gmail", () => ({
  extractTripPlanFromEmail: async () => {
    if (mocks.extractError) throw mocks.extractError;
    return mocks.items;
  },
}));

import { MailPlanImport } from "./MailPlanImport";

const email = { id: "mail-1", subject: "予約確認" } as SyncedEmail;
const account = { id: "acc-1", email: "me@example.com" } as GmailAccount;

function renderSheet() {
  return render(
    <ToastProvider>
      <MailPlanImport email={email} account={account} open onClose={() => {}} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  mocks.items = [{ date: "2026-09-12", startTime: "08:20", title: "羽田→福岡", type: "transport" }];
  mocks.extractError = null;
  mocks.trips = [{ id: "trip-1", name: "福岡旅行", startDate: "2026-09-11", endDate: "2026-09-15" }];
  mocks.saved = { tripSchedule: [], tripExpenses: [], calendarEvents: [], tasks: [] };
});

afterEach(cleanup);

describe("メールから予定を作る画面", () => {
  it("読み取り結果と、入れ先の3択を出す", async () => {
    // この画面はメール詳細の中に常に描かれる。ここが実行時に落ちると
    // メールが開けなくなる(2026-08-25の不具合)ので、描画そのものを固定する。
    renderSheet();
    expect(await screen.findByRole("tab", { name: "旅行の日程" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "予定" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "タスク" })).toBeTruthy();
    expect(screen.getByDisplayValue("羽田→福岡")).toBeTruthy();
  });

  it("旅行の日程に入れる", async () => {
    const user = userEvent.setup();
    renderSheet();
    const save = await screen.findByRole("button", { name: "1件を入れる" });
    // 入れ先の旅行が決まるまでは押せない(旅行の読み込みを待つ)。
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await user.click(save);
    expect(mocks.saved.tripSchedule).toEqual([expect.objectContaining({ tripId: "trip-1", title: "羽田→福岡" })]);
  });

  it("予定に入れる", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(await screen.findByRole("tab", { name: "予定" }));
    await user.click(screen.getByRole("button", { name: "1件を入れる" }));
    expect(mocks.saved.calendarEvents).toEqual([expect.objectContaining({ date: "2026-09-12", startTime: "08:20" })]);
    expect(mocks.saved.tripSchedule).toEqual([]);
  });

  it("タスクに入れる", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(await screen.findByRole("tab", { name: "タスク" }));
    await user.click(screen.getByRole("button", { name: "1件を入れる" }));
    expect(mocks.saved.tasks).toEqual([expect.objectContaining({ dueDate: "2026-09-12", completed: false })]);
  });

  it("旅行が1つも無くても、予定とタスクには入れられる", async () => {
    // 旅行が無いことを理由に画面ごと使えなくすると、予定・タスクまで巻き添えになる。
    mocks.trips = [];
    const user = userEvent.setup();
    renderSheet();
    await user.click(await screen.findByRole("tab", { name: "タスク" }));
    await user.click(screen.getByRole("button", { name: "1件を入れる" }));
    expect(mocks.saved.tasks).toHaveLength(1);
  });

  it("読み取りに失敗したら、理由をそのまま出す", async () => {
    mocks.extractError = new Error("Anthropic API error: 429");
    renderSheet();
    expect(await screen.findByText(/Anthropic API error: 429/)).toBeTruthy();
  });

  it("見つからなければ、その旨を出す", async () => {
    mocks.items = [];
    renderSheet();
    expect(await screen.findByText(/見つかりませんでした/)).toBeTruthy();
  });
});

describe("費用", () => {
  it("金額が読み取れていれば、日程と一緒に旅行の費用にも積む", async () => {
    mocks.items = [
      { date: "2026-09-19", startTime: "10:05", title: "岡山→新横浜 のぞみ124号", type: "transport", amount: 12540 },
    ];
    const user = userEvent.setup();
    renderSheet();
    const save = await screen.findByRole("button", { name: "1件を入れる" });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await user.click(save);

    expect(mocks.saved.tripSchedule).toHaveLength(1);
    expect(mocks.saved.tripExpenses).toEqual([
      expect.objectContaining({ amount: 12540, category: "transport", paidDate: "2026-09-19", paid: true }),
    ]);
  });

  it("宿泊なら宿泊費として積む", async () => {
    mocks.items = [{ date: "2026-09-19", title: "ホテルにチェックイン", type: "lodging", amount: 18000 }];
    const user = userEvent.setup();
    renderSheet();
    const save = await screen.findByRole("button", { name: "1件を入れる" });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await user.click(save);
    expect(mocks.saved.tripExpenses).toEqual([expect.objectContaining({ category: "lodging", amount: 18000 })]);
  });

  it("金額が読み取れなければ、費用は積まない", async () => {
    mocks.items = [{ date: "2026-09-19", title: "岡山→新横浜", type: "transport" }];
    const user = userEvent.setup();
    renderSheet();
    const save = await screen.findByRole("button", { name: "1件を入れる" });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await user.click(save);
    expect(mocks.saved.tripSchedule).toHaveLength(1);
    expect(mocks.saved.tripExpenses).toEqual([]);
  });

  it("「費用にも入れる」を外せば、日程だけ入れる", async () => {
    mocks.items = [{ date: "2026-09-19", title: "岡山→新横浜", type: "transport", amount: 12540 }];
    const user = userEvent.setup();
    renderSheet();
    await user.click(await screen.findByRole("switch", { name: /費用にも入れる/ }));
    const save = screen.getByRole("button", { name: "1件を入れる" });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await user.click(save);
    expect(mocks.saved.tripSchedule).toHaveLength(1);
    expect(mocks.saved.tripExpenses).toEqual([]);
  });

  it("予定・タスクには費用の欄を出さない", async () => {
    mocks.items = [{ date: "2026-09-19", title: "岡山→新横浜", type: "transport", amount: 12540 }];
    const user = userEvent.setup();
    renderSheet();
    await user.click(await screen.findByRole("tab", { name: "予定" }));
    expect(screen.queryByRole("switch", { name: /費用にも入れる/ })).toBeNull();
  });
});
