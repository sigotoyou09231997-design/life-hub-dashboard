/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TripScheduleItem } from "../../types";
import { ConfirmProvider } from "../ui/ConfirmProvider";

const mocks = vi.hoisted(() => ({
  added: [] as unknown[],
  updated: [] as [string, unknown][],
  savedPhotos: [] as [string, string, unknown[]][],
  existingPhotos: [] as unknown[],
  linkedExpense: undefined as undefined | Record<string, unknown>,
  expenseAdded: [] as unknown[],
  expenseUpdated: [] as [string, unknown][],
  expenseDeleted: [] as string[],
}));

vi.mock("../../lib/currency", async () => {
  const actual = await vi.importActual<typeof import("../../lib/currency")>("../../lib/currency");
  return { ...actual, deleteCurrencyFor: async () => {} };
});

// 写真は別のテーブル(端末の中だけ)。ここでは「どの予定に何枚貼るか」だけを見る。
vi.mock("../../lib/attachments", async () => {
  const actual = await vi.importActual<typeof import("../../lib/attachments")>("../../lib/attachments");
  return {
    ...actual,
    loadAttachmentDrafts: async () => mocks.existingPhotos,
    saveAttachmentDrafts: async (ownerType: string, ownerId: string, drafts: unknown[]) => void mocks.savedPhotos.push([ownerType, ownerId, drafts]),
  };
});

vi.mock("../../db/schema", () => ({
  db: {
    tripSchedule: {
      add: async (row: unknown) => {
        mocks.added.push(row);
        return "new-schedule-id";
      },
      update: async (id: string, row: unknown) => void mocks.updated.push([id, row]),
    },
    tripExpenses: {
      where: () => ({ equals: () => ({ filter: () => ({ first: async () => mocks.linkedExpense }) }) }),
      add: async (row: unknown) => void mocks.expenseAdded.push(row),
      update: async (id: string, patch: unknown) => void mocks.expenseUpdated.push([id, patch]),
      delete: async (id: string) => void mocks.expenseDeleted.push(id),
    },
  },
}));

import { TripScheduleForm } from "./TripScheduleForm";

beforeEach(() => {
  // jsdom には createObjectURL が無い(写真の見本を出す時に使う)。
  Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => {} });
  mocks.added = [];
  mocks.updated = [];
  mocks.savedPhotos = [];
  mocks.existingPhotos = [];
  mocks.linkedExpense = undefined;
  mocks.expenseAdded = [];
  mocks.expenseUpdated = [];
  mocks.expenseDeleted = [];
});
afterEach(cleanup);

function renderForm(initial?: TripScheduleItem, members?: string[] | null, onDelete?: () => void) {
  const saved = vi.fn();
  render(
    <TripScheduleForm tripId="t1" initial={initial} members={members} defaultDate="2026-12-27" onSaved={saved} onCancel={() => {}} onDelete={onDelete} />,
    { wrapper: ConfirmProvider },
  );
  return saved;
}

describe("旅行の予定の入力: 移動手段", () => {
  it("種類が「移動」の時だけ、移動手段を選ぶ欄が出る", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.queryByText("移動手段")).toBeNull();
    await user.click(screen.getByRole("button", { name: "移動" }));
    expect(screen.getByText("移動手段")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新幹線" })).toBeTruthy();
  });

  it("選んだ移動手段を保存する", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByPlaceholderText("例: 五稜郭"), "東京→岡山");
    await user.click(screen.getByRole("button", { name: "移動" }));
    await user.click(screen.getByRole("button", { name: "新幹線" }));
    await user.click(screen.getByRole("button", { name: "予定を追加" }));
    expect(mocks.added).toEqual([expect.objectContaining({ title: "東京→岡山", type: "transport", transportMode: "shinkansen" })]);
  });

  it("「未定」に戻したり、種類を移動から変えたりしたら、移動手段は残さない", async () => {
    const user = userEvent.setup();
    renderForm({ id: "s1", tripId: "t1", date: "2026-12-27", title: "高松→鳴門", type: "transport", transportMode: "car", createdAt: 1 });
    expect(screen.getByRole("button", { name: "車" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "観光" }));
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(mocks.updated[0][1]).toMatchObject({ type: "sightseeing", transportMode: undefined });
  });
});

describe("旅行の予定の入力: 写真", () => {
  it("新しい予定は、保存して得た id に写真を貼る(写真の欄がある)", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByText("写真")).toBeTruthy();
    expect(screen.getByText(/この端末の中だけに残ります/)).toBeTruthy();
    await user.type(screen.getByPlaceholderText("例: 五稜郭"), "霊山寺");
    await user.click(screen.getByRole("button", { name: "予定を追加" }));
    expect(mocks.savedPhotos).toEqual([["tripSchedule", "new-schedule-id", []]]);
  });

  it("今ある予定を開くと、貼ってある写真を読み直し、保存するとその予定に書き直す", async () => {
    mocks.existingPhotos = [{ id: "p1", name: "a.jpg", blob: new Blob(["x"], { type: "image/jpeg" }), previewUrl: "blob:x" }];
    const user = userEvent.setup();
    renderForm({ id: "s9", tripId: "t1", date: "2026-12-27", title: "桂浜", type: "sightseeing", createdAt: 1 });
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(mocks.savedPhotos[0][0]).toBe("tripSchedule");
    expect(mocks.savedPhotos[0][1]).toBe("s9");
    expect(mocks.savedPhotos[0][2]).toHaveLength(1);
  });
});

describe("旅行の予定の入力: 詳細", () => {
  it("ふだんは畳んであり、開くと住所・電話・URL・営業時間を入れて保存できる", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.queryByText("住所")).toBeNull();
    await user.type(screen.getByPlaceholderText("例: 五稜郭"), "うずしお観潮船");
    await user.click(screen.getByRole("button", { name: /住所・電話・URL・営業時間/ }));
    await user.type(screen.getByPlaceholderText(/土佐泊浦/), "徳島県鳴門市鳴門町土佐泊浦字大毛264-1");
    await user.type(screen.getByPlaceholderText("例: 088-687-0613"), "088-687-0613");
    await user.type(screen.getByPlaceholderText(/https:\/\/www/), "www.uzusio.com");
    await user.type(screen.getByPlaceholderText(/水曜休み/), "9:00〜16:30");
    await user.click(screen.getByRole("button", { name: "予定を追加" }));
    expect(mocks.added[0]).toMatchObject({
      address: "徳島県鳴門市鳴門町土佐泊浦字大毛264-1",
      phone: "088-687-0613",
      url: "https://www.uzusio.com",
      openingHours: "9:00〜16:30",
    });
  });

  it("宿泊の予定では、営業時間の代わりにチェックイン・チェックアウトを入れる", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByPlaceholderText("例: 五稜郭"), "ダイワロイネットホテル");
    await user.click(screen.getByRole("button", { name: "宿泊" }));
    await user.click(screen.getByRole("button", { name: /チェックイン\/アウト/ }));
    expect(screen.queryByPlaceholderText(/水曜休み/)).toBeNull();
    expect(screen.getByText("チェックイン")).toBeTruthy();
    expect(screen.getByText("チェックアウト")).toBeTruthy();
  });

  it("電話番号は数字だけ打てば、欄を離れた時にハイフンが入る(電話用テンキーにハイフンが無いため)", async () => {
    const user = userEvent.setup();
    renderForm({ id: "s1", tripId: "t1", date: "2026-12-27", title: "うずしお観潮船", type: "sightseeing", phone: "", address: "徳島県鳴門市", createdAt: 1 });
    const phone = screen.getByPlaceholderText("例: 088-687-0613") as HTMLInputElement;
    await user.type(phone, "0886870613");
    await user.tab();
    expect(phone.value).toBe("088-687-0613");
  });

  it("詳細が入っている予定を開くと、詳細を開いた状態で出す", () => {
    renderForm({ id: "s1", tripId: "t1", date: "2026-12-27", title: "桂浜", type: "sightseeing", phone: "088-000-0000", createdAt: 1 });
    expect((screen.getByPlaceholderText("例: 088-687-0613") as HTMLInputElement).value).toBe("088-000-0000");
  });
});

describe("旅行の予定の入力: 費用と支払った人", () => {
  it("金額と支払った人を入れると、その予定の費用を作る(費用タブにも出る)", async () => {
    const user = userEvent.setup();
    renderForm(undefined, ["ふなだ", "えっくん"]);
    await user.type(screen.getByPlaceholderText("例: 五稜郭"), "うずしお観潮船");
    await user.type(screen.getByLabelText(/^金額/), "2500");
    await user.click(screen.getByRole("button", { name: "えっくん" }));
    await user.click(screen.getByRole("button", { name: "予定を追加" }));
    expect(mocks.expenseAdded).toEqual([
      expect.objectContaining({ tripId: "t1", title: "うずしお観潮船", amount: 2500, paidBy: "えっくん", scheduleId: "new-schedule-id", category: "sightseeing" }),
    ]);
  });

  it("参加者がいなければ、支払った人の代わりに案内を出す(金額だけは入れられる)", () => {
    renderForm();
    expect(screen.queryByRole("button", { name: "決めていない" })).toBeNull();
    expect(screen.getByText(/参加者を入れると、誰が払ったかも選べます/)).toBeTruthy();
  });

  it("参加者の列が null(同期で降りてきた、参加者を入れていない旅行)でも開ける", async () => {
    // 2026-10-11、本番で予定を押すと真っ白になった。既定値の [] が null には効かず .length で落ちていた。
    renderForm({ id: "s1", tripId: "t1", date: "2026-12-28", title: "桂浜", type: "sightseeing", createdAt: 1 }, null);
    expect(await screen.findByText(/参加者を入れると、誰が払ったかも選べます/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "変更を保存" })).toBeTruthy();
  });

  it("今ある予定の費用を読み、直すと書き換える。金額を消すと、その費用を消す", async () => {
    mocks.linkedExpense = { id: "e1", tripId: "t1", title: "桂浜", amount: 1000, paidBy: "ふなだ", scheduleId: "s1" };
    const user = userEvent.setup();
    renderForm({ id: "s1", tripId: "t1", date: "2026-12-28", title: "桂浜", type: "sightseeing", createdAt: 1 }, ["ふなだ", "えっくん"]);
    const amount = await screen.findByDisplayValue("1000");
    await user.clear(amount);
    await user.type(amount, "1200");
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(mocks.expenseUpdated).toEqual([["e1", { amount: 1200, paidBy: "ふなだ", title: "桂浜" }]]);

    cleanup();
    mocks.expenseUpdated = [];
    renderForm({ id: "s1", tripId: "t1", date: "2026-12-28", title: "桂浜", type: "sightseeing", createdAt: 1 }, ["ふなだ"]);
    await user.clear(await screen.findByDisplayValue("1000"));
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(mocks.expenseDeleted).toEqual(["e1"]);
  });
});

describe("旅行の予定の入力: 入れ替えた並び", () => {
  const placed: TripScheduleItem = { id: "s1", tripId: "t1", date: "2026-12-28", startTime: "06:00", title: "ホテル出発", type: "other", sortOrder: 2, createdAt: 1 };

  it("開始時刻を直したら、並びから外して時刻の位置へ戻す(null で、ほかの端末にも消える)", async () => {
    renderForm(placed);
    fireEvent.change(screen.getByLabelText(/^開始時刻/), { target: { value: "07:30" } });
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
    await waitFor(() => expect(mocks.updated[0]?.[1]).toMatchObject({ startTime: "07:30", sortOrder: null }));
  });

  it("時刻を変えなければ、入れ替えた並びは残す", async () => {
    renderForm(placed);
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
    await waitFor(() => expect(mocks.updated.length).toBe(1));
    expect(mocks.updated[0][1]).not.toHaveProperty("sortOrder");
  });
});

describe("旅行の予定の入力: 削除", () => {
  const existing: TripScheduleItem = { id: "s1", tripId: "t1", date: "2026-12-28", title: "桂浜", type: "sightseeing", createdAt: 1 };

  it("新しい予定には「この予定を削除」を出さない", () => {
    renderForm(undefined, undefined, vi.fn());
    expect(screen.queryByRole("button", { name: "この予定を削除" })).toBeNull();
  });

  it("今ある予定は、いちばん下の「この予定を削除」から、確認のあとで消す(やめれば消さない)", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    renderForm(existing, undefined, onDelete);

    await user.click(screen.getByRole("button", { name: "この予定を削除" }));
    const ask = screen.getByRole("dialog", { name: "「桂浜」を削除しますか?" });
    await user.click(within(ask).getByRole("button", { name: "キャンセル" }));
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "この予定を削除" }));
    await user.click(within(screen.getByRole("dialog", { name: "「桂浜」を削除しますか?" })).getByRole("button", { name: "削除する" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    // 消すだけで、保存はしない。
    expect(mocks.updated).toEqual([]);
  });
});
