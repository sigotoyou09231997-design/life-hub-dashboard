/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  extractError: null as Error | null,
  existingEvents: [] as Record<string, unknown>[],
  saved: [] as Record<string, unknown>[],
  sent: [] as Record<string, unknown>[],
}));

vi.mock("../../db/schema", () => ({
  db: {
    calendarEvents: {
      add: async (row: Record<string, unknown>) => void mocks.saved.push(row),
      toArray: async () => mocks.existingEvents,
    },
  },
}));

// useLiveQuery は本物のDexieテーブルを相手にしないと値を返さないので、問い合わせを
// 1回実行するだけの最小版に差し替える(TripPlanScanForm.test.tsx と同じ)。
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

vi.mock("../../lib/tripPlanScan", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tripPlanScan")>("../../lib/tripPlanScan");
  return {
    ...actual,
    extractTripPlanFromSources: async (input: Record<string, unknown>) => {
      mocks.sent.push(input);
      if (mocks.extractError) throw mocks.extractError;
      return mocks.items;
    },
  };
});

import { EventScanForm } from "./EventScanForm";

function renderForm(onSaved: (message: string, firstDate: string) => void = () => {}) {
  return render(<EventScanForm onSaved={onSaved} onCancel={() => {}} />);
}

async function readFromText(user: ReturnType<typeof userEvent.setup>, text = "9/30 15:00 歯医者") {
  await user.type(screen.getByPlaceholderText(/歯医者/), text);
  await user.click(screen.getByRole("button", { name: "読み取る" }));
}

beforeEach(() => {
  mocks.items = [{ date: "2026-09-30", startTime: "15:00", endTime: "16:00", title: "歯医者", location: "OO歯科", type: "other" }];
  mocks.extractError = null;
  mocks.existingEvents = [];
  mocks.saved = [];
  mocks.sent = [];
});

afterEach(cleanup);

describe("写真・文章から予定を作る画面", () => {
  it("写真と文章の入り口を出す(読み取るのは、どちらかを入れてから)", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /写真を選ぶ/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: "読み取る" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("読み取った内容を、そのまま保存せず確認させる", async () => {
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByDisplayValue("歯医者")).toBeTruthy();
    expect(mocks.saved).toEqual([]);
    // 旅行ではないので、旅行の期間は渡さない。「来週の火曜」を直すための今日の日付だけ。
    expect(mocks.sent[0]).toMatchObject({ text: "9/30 15:00 歯医者" });
    expect(mocks.sent[0].tripStart).toBeUndefined();
    expect(mocks.sent[0].today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("確認した分を予定に入れ、いちばん早い日付を知らせる", async () => {
    mocks.items = [
      { date: "2026-10-04", startTime: "18:30", title: "渋谷で飲み会", type: "meal" },
      { date: "2026-09-30", startTime: "15:00", title: "歯医者", type: "other" },
      { date: "2026-10-10", title: "書類の提出締切", type: "other" },
    ];
    const saved = vi.fn();
    const user = userEvent.setup();
    renderForm(saved);
    await readFromText(user);
    await user.click(screen.getByRole("button", { name: "3件を入れる" }));
    expect(mocks.saved).toEqual([
      expect.objectContaining({ date: "2026-10-04", startTime: "18:30", title: "渋谷で飲み会", allDay: false }),
      expect.objectContaining({ date: "2026-09-30", startTime: "15:00", title: "歯医者" }),
      // 時刻の無いものは終日の予定になる。
      expect.objectContaining({ date: "2026-10-10", title: "書類の提出締切", allDay: true }),
    ]);
    expect(saved).toHaveBeenCalledWith("予定に3件入れました", "2026-09-30");
  });

  it("同じ内容が既に予定にあれば入れない", async () => {
    mocks.existingEvents = [{ date: "2026-09-30", startTime: "15:00", title: "歯医者" }];
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText("すでに登録されています")).toBeTruthy();
    expect((screen.getByRole("button", { name: "0件を入れる" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("同じ日に似た予定があれば、外した状態で並べる(自分でチェックすれば入る)", async () => {
    mocks.existingEvents = [{ date: "2026-09-30", title: "歯医者" }];
    mocks.items = [{ date: "2026-09-30", startTime: "15:00", title: "OO歯科 歯医者", type: "other" }];
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText(/同じ日に「歯医者」があります/)).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "OO歯科 歯医者を入れる" }));
    await user.click(screen.getByRole("button", { name: "1件を入れる" }));
    expect(mocks.saved).toHaveLength(1);
  });

  it("旅行の費用の欄は出さない", async () => {
    mocks.items = [{ date: "2026-09-30", title: "ライブ", type: "other", amount: 8800 }];
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.queryByRole("switch", { name: "費用にも入れる" })).toBeNull();
  });

  it("読み取れなかった時は、やり直せる", async () => {
    mocks.items = [];
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText("予定になりそうな内容は見つかりませんでした")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "やり直す" }));
    expect(screen.getByRole("button", { name: "読み取る" })).toBeTruthy();
  });

  it("失敗した理由をそのまま出す", async () => {
    mocks.extractError = Object.assign(new Error("写真が大きすぎます"), { status: 400 });
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText("予定を読み取れませんでした。")).toBeTruthy();
    expect(screen.getByText(/写真が大きすぎます/)).toBeTruthy();
  });
});
