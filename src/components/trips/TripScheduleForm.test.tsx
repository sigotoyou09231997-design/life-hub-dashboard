/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TripScheduleItem } from "../../types";

const mocks = vi.hoisted(() => ({
  added: [] as unknown[],
  updated: [] as [string, unknown][],
  savedPhotos: [] as [string, string, unknown[]][],
  existingPhotos: [] as unknown[],
}));

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
});
afterEach(cleanup);

function renderForm(initial?: TripScheduleItem) {
  const saved = vi.fn();
  render(<TripScheduleForm tripId="t1" initial={initial} defaultDate="2026-12-27" onSaved={saved} onCancel={() => {}} />);
  return saved;
}

describe("旅行の予定の入力: 移動手段", () => {
  it("種類が「移動」の時だけ、移動手段を選ぶ欄が出る", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.queryByText("移動手段")).toBeNull();
    await user.selectOptions(screen.getByRole("combobox"), "transport");
    expect(screen.getByText("移動手段")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新幹線" })).toBeTruthy();
  });

  it("選んだ移動手段を保存する", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByPlaceholderText("例: 五稜郭"), "東京→岡山");
    await user.selectOptions(screen.getByRole("combobox"), "transport");
    await user.click(screen.getByRole("button", { name: "新幹線" }));
    await user.click(screen.getByRole("button", { name: "予定を追加" }));
    expect(mocks.added).toEqual([expect.objectContaining({ title: "東京→岡山", type: "transport", transportMode: "shinkansen" })]);
  });

  it("「未定」に戻したり、種類を移動から変えたりしたら、移動手段は残さない", async () => {
    const user = userEvent.setup();
    renderForm({ id: "s1", tripId: "t1", date: "2026-12-27", title: "高松→鳴門", type: "transport", transportMode: "car", createdAt: 1 });
    expect(screen.getByRole("button", { name: "車" }).getAttribute("aria-pressed")).toBe("true");
    await user.selectOptions(screen.getByRole("combobox"), "sightseeing");
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
    await user.selectOptions(screen.getByRole("combobox"), "lodging");
    await user.click(screen.getByRole("button", { name: /チェックイン\/アウト/ }));
    expect(screen.queryByPlaceholderText(/水曜休み/)).toBeNull();
    expect(screen.getByText("チェックイン")).toBeTruthy();
    expect(screen.getByText("チェックアウト")).toBeTruthy();
  });

  it("詳細が入っている予定を開くと、詳細を開いた状態で出す", () => {
    renderForm({ id: "s1", tripId: "t1", date: "2026-12-27", title: "桂浜", type: "sightseeing", phone: "088-000-0000", createdAt: 1 });
    expect((screen.getByPlaceholderText("例: 088-687-0613") as HTMLInputElement).value).toBe("088-000-0000");
  });
});

