/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Task } from "../../types";
import type { PlaceReminderDraft } from "../../lib/placeReminders";

const mocks = vi.hoisted(() => ({
  added: [] as Task[],
  updated: [] as Task[],
  reminderDrafts: [] as PlaceReminderDraft[],
}));

vi.mock("../../db/schema", () => ({
  db: {
    tasks: {
      add: async (row: Task) => {
        mocks.added.push(row);
        return "new-task";
      },
      update: async (_id: string, row: Task) => {
        mocks.updated.push(row);
        return 1;
      },
    },
  },
}));

// 場所リマインドは別のテーブルに読み書きする。ここでは渡された下書きだけ控える。
vi.mock("../../lib/placeReminders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/placeReminders")>();
  return {
    ...actual,
    loadPlaceReminderDraft: async () => actual.EMPTY_PLACE_REMINDER_DRAFT,
    savePlaceReminderDraft: async (_type: string, _id: string, draft: PlaceReminderDraft) => {
      mocks.reminderDrafts.push(draft);
    },
  };
});

import { TaskForm } from "./TaskForm";

const existingTask: Task = {
  id: "task-1",
  title: "健康診断の予約",
  priority: "medium",
  dueDate: "2026-10-20",
  dueTime: "10:00",
  category: "other",
  completed: false,
  repeat: "none",
  createdAt: 1_000,
};

function renderForm(initial?: Task) {
  return render(<TaskForm initial={initial} onSaved={() => {}} onCancel={() => {}} />);
}

beforeEach(() => {
  mocks.added = [];
  mocks.updated = [];
  mocks.reminderDrafts = [];
});

afterEach(cleanup);

// iPhone ではシートの中のプルダウンを押すとキーボードが閉じてシートが動き、選択肢が欄から離れた所に出る
// (2026-10-12)。予定の画面(EventForm.test.tsx)と同じく、この画面にもプルダウンを置かない。
describe("通知・カテゴリ・場所の距離はプルダウンにしない", () => {
  it("ボタンで選べ、保存される値は今までと同じ", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.queryByRole("combobox")).toBeNull();

    await user.type(screen.getByLabelText("タイトル"), "書類を出す");
    await user.click(screen.getByRole("button", { name: "30分前" }));
    await user.click(screen.getByRole("button", { name: "仕事" }));
    await user.click(screen.getByRole("button", { name: "タスクを追加" }));

    expect(mocks.added[0]).toMatchObject({ title: "書類を出す", notifyMinutesBefore: 30, category: "work" });
  });

  it("「通知しない」は今までどおり値を持たない", async () => {
    const user = userEvent.setup();
    renderForm({ ...existingTask, notifyMinutesBefore: 10 });
    await user.click(screen.getByRole("button", { name: "通知しない" }));
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(mocks.updated[0].notifyMinutesBefore).toBeUndefined();
  });

  it("開いたタスクの通知とカテゴリが、選ばれた状態で出る", () => {
    renderForm({ ...existingTask, notifyMinutesBefore: 60, category: "important" });
    expect(screen.getByRole("button", { name: "1時間前" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "重要" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "その他" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("選択肢に無い分数の通知も、消さずに見えるように出す", async () => {
    const user = userEvent.setup();
    renderForm({ ...existingTask, notifyMinutesBefore: 15 });
    expect(screen.getByRole("button", { name: "15分前" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(mocks.updated[0].notifyMinutesBefore).toBe(15);
  });

  it("場所で知らせる距離もボタンで選べ、メートルの数で保存される", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("タイトル"), "牛乳を買う");
    await user.click(screen.getByRole("switch", { name: /^場所で知らせる/ }));
    expect(screen.queryByRole("combobox")).toBeNull();
    // 既定は200m。
    expect(screen.getByRole("button", { name: "200m" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "1km" }));
    expect(screen.getByRole("button", { name: "1km" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "タスクを追加" }));

    expect(mocks.reminderDrafts[0]).toMatchObject({ enabled: true, radiusMeters: 1000 });
  });
});
