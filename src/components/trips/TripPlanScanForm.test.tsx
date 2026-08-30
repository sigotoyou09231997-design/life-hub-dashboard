/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Trip } from "../../types";

const mocks = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  extractError: null as Error | null,
  existingTripSchedule: [] as Record<string, unknown>[],
  saved: { tripSchedule: [] as unknown[], tripExpenses: [] as unknown[] },
  sent: [] as Record<string, unknown>[],
}));

vi.mock("../../db/schema", () => ({
  db: {
    tripSchedule: {
      add: async (row: unknown) => void mocks.saved.tripSchedule.push(row),
      where: () => ({ equals: () => ({ toArray: async () => mocks.existingTripSchedule }) }),
    },
    tripExpenses: { add: async (row: unknown) => void mocks.saved.tripExpenses.push(row) },
  },
}));

// useLiveQuery は本物のDexieテーブルを相手にしないと値を返さない。ここで見たいのは
// 画面の組み立てなので、問い合わせ関数を1回実行するだけの最小版に差し替える
// (src/components/gmail/MailPlanImport.test.tsx と同じ)。
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

import { TripPlanScanForm } from "./TripPlanScanForm";

const trip = { id: "trip-1", name: "函館旅行", startDate: "2026-09-12", endDate: "2026-09-14" } as Trip;

function renderForm(onSaved = () => {}) {
  return render(<TripPlanScanForm tripId="trip-1" trip={trip} onSaved={onSaved} onCancel={() => {}} />);
}

/** 文章を貼って読み取らせるところまで。 */
async function readFromText(user: ReturnType<typeof userEvent.setup>, text = "9/12 10:00 羽田発") {
  await user.type(screen.getByPlaceholderText(/羽田発/), text);
  await user.click(screen.getByRole("button", { name: "読み取る" }));
}

beforeEach(() => {
  mocks.items = [{ date: "2026-09-12", startTime: "08:20", title: "羽田→福岡", type: "transport", amount: 12540 }];
  mocks.extractError = null;
  mocks.existingTripSchedule = [];
  mocks.saved = { tripSchedule: [], tripExpenses: [] };
  mocks.sent = [];
});

afterEach(cleanup);

describe("写真・文章から日程を読み取る画面", () => {
  it("写真と文章の入り口を出す(読み取るのは、どちらかを入れてから)", () => {
    // 旅行の日程タブから常に開ける画面。ここが実行時に落ちると日程が触れなくなる。
    renderForm();
    expect(screen.getByRole("button", { name: /写真を選ぶ/ })).toBeTruthy();
    expect(screen.getByPlaceholderText(/羽田発/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "読み取る" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("読み取った内容を、そのまま保存せず確認させる", async () => {
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByDisplayValue("羽田→福岡")).toBeTruthy();
    expect(mocks.saved.tripSchedule).toEqual([]);
    // 「2日目」を実際の日付に直せるよう、旅行の期間を渡している。
    expect(mocks.sent[0]).toMatchObject({ tripStart: "2026-09-12", tripEnd: "2026-09-14" });
  });

  it("確認した分を、この旅行の日程に入れる", async () => {
    const saved = vi.fn();
    const user = userEvent.setup();
    renderForm(saved);
    await readFromText(user);
    await user.click(screen.getByRole("button", { name: "1件を入れる" }));
    expect(mocks.saved.tripSchedule).toEqual([
      expect.objectContaining({ tripId: "trip-1", date: "2026-09-12", startTime: "08:20", title: "羽田→福岡" }),
    ]);
    // 金額が読み取れた分は、既定で旅行の費用にも積む(外せる)。
    expect(mocks.saved.tripExpenses).toEqual([expect.objectContaining({ tripId: "trip-1", amount: 12540 })]);
    expect(saved).toHaveBeenCalledWith("日程に1件、費用に1件入れました");
  });

  it("費用を外せば、日程だけ入る", async () => {
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    await user.click(screen.getByRole("switch", { name: "費用にも入れる" }));
    await user.click(screen.getByRole("button", { name: "1件を入れる" }));
    expect(mocks.saved.tripSchedule).toHaveLength(1);
    expect(mocks.saved.tripExpenses).toEqual([]);
  });

  it("同じ内容が既に日程にあれば入れない", async () => {
    // 同じしおりを2回読ませても、日程表が二重にならないようにする。
    mocks.existingTripSchedule = [{ date: "2026-09-12", startTime: "08:20", title: "羽田→福岡" }];
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText("すでに登録されています")).toBeTruthy();
    expect((screen.getByRole("button", { name: "0件を入れる" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("同じ日に似た予定があれば、外した状態で並べて断りを出す", async () => {
    // しおりを読み直すたびに同じ予定が積み上がるのを、押す前に止める。
    // 完全一致と違って入れられる(重ねたい時もある)ので、チェックだけ外しておく。
    mocks.existingTripSchedule = [{ date: "2026-09-19", title: "鎌倉散歩" }];
    mocks.items = [{ date: "2026-09-19", title: "お迎え・買い出し・鎌倉散歩", type: "sightseeing" }];
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText(/同じ日に「鎌倉散歩」があります/)).toBeTruthy();
    const save = screen.getByRole("button", { name: "0件を入れる" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // 重ねて入れたい時は、自分でチェックすれば入る。
    await user.click(screen.getByRole("checkbox", { name: "お迎え・買い出し・鎌倉散歩を入れる" }));
    await user.click(screen.getByRole("button", { name: "1件を入れる" }));
    expect(mocks.saved.tripSchedule).toHaveLength(1);
  });

  it("しおり1枚ぶん(時刻の無い8日分)をまとめて入れる", async () => {
    // 時刻の書かれていない旅程表がいちばん多い形。日付だけで入れられること、
    // 1日に複数の予定が並んでも別々の行になることを固定する。
    mocks.items = [
      { date: "2026-09-19", title: "鎌倉散歩", location: "鎌倉", type: "sightseeing" },
      { date: "2026-09-20", title: "初心者船釣り", location: "腰越", type: "sightseeing" },
      { date: "2026-09-21", title: "海沿いドライブ", location: "葉山・三浦半島", type: "transport" },
      { date: "2026-09-22", title: "えのすい", location: "江の島", type: "sightseeing" },
      { date: "2026-09-22", title: "江の島灯籠", location: "江の島", type: "sightseeing" },
      { date: "2026-09-23", title: "トイ・ストーリー5", location: "辻堂", type: "other" },
      { date: "2026-09-24", title: "みなとみらい・中華街", location: "横浜", type: "sightseeing" },
      { date: "2026-09-25", title: "大涌谷・芦ノ湖・温泉", location: "箱根", type: "sightseeing" },
    ];
    const saved = vi.fn();
    const user = userEvent.setup();
    renderForm(saved);
    await readFromText(user);
    await user.click(screen.getByRole("button", { name: "8件を入れる" }));
    expect(mocks.saved.tripSchedule).toHaveLength(8);
    // 金額が読み取れていない分は、費用には積まない。
    expect(mocks.saved.tripExpenses).toEqual([]);
    expect(saved).toHaveBeenCalledWith("日程に8件入れました");
  });

  it("旅行の期間から外れた日付には印を出す", async () => {
    // 入れられるが日程表には出てこないので、気付けるようにする。
    mocks.items = [{ date: "2026-10-01", title: "五稜郭", type: "sightseeing" }];
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText(/この旅行の期間の外です/)).toBeTruthy();
  });

  it("読み取れなかった時は、やり直せる", async () => {
    mocks.items = [];
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText("日程になりそうな内容は見つかりませんでした")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "やり直す" }));
    expect(screen.getByRole("button", { name: "読み取る" })).toBeTruthy();
  });

  it("失敗した理由をそのまま出す", async () => {
    mocks.extractError = Object.assign(new Error("写真が大きすぎます"), { status: 400 });
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText("写真が大きすぎます")).toBeTruthy();
  });
});
