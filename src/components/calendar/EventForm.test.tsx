/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CalendarEvent } from "../../types";
import { ToastProvider } from "../ui/ToastProvider";

const mocks = vi.hoisted(() => ({
  others: [] as { userId: string; dbName: string; label: string; email: string | null }[],
  added: [] as CalendarEvent[],
  updated: [] as CalendarEvent[],
  copies: [] as { label: string; title: string }[],
}));

vi.mock("../../db/schema", () => ({
  db: {
    calendarEvents: {
      add: async (row: CalendarEvent) => {
        mocks.added.push(row);
        return "new-row";
      },
      update: async (_id: string, row: CalendarEvent) => {
        mocks.updated.push(row);
        return 1;
      },
    },
  },
}));

// 複製先の一覧と実際の書き込みだけ差し替える。どの予定名で何件足すかを決める
// 素の関数(planAccountEvents など)は本物のまま動かす。
vi.mock("../../lib/crossAccountEvents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/crossAccountEvents")>()),
  listOtherAccounts: () => mocks.others,
  addEventToAccount: async (account: { label: string }, event: CalendarEvent) => {
    mocks.copies.push({ label: account.label, title: event.title });
  },
}));

import { EventForm } from "./EventForm";

const existingEvent: CalendarEvent = {
  id: "event-1",
  title: "面接",
  date: "2026-09-01",
  allDay: true,
  category: "other",
  createdAt: 1_000,
};

function renderForm(initial?: CalendarEvent) {
  return render(
    <ToastProvider>
      <EventForm initial={initial} defaultDate="2026-09-01" onSaved={() => {}} onCancel={() => {}} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  mocks.others = [];
  mocks.added = [];
  mocks.updated = [];
  mocks.copies = [];
});

afterEach(cleanup);

describe("ほかのアカウントにも入れる欄", () => {
  it("アカウントが1つだけなら出さない", () => {
    renderForm();
    expect(screen.queryByText("ほかのアカウントにも入れる")).toBeNull();
  });

  it("2つ以上あれば、新規作成で出る", () => {
    mocks.others = [{ userId: "work", dbName: "life-hub-work", label: "仕事用", email: "work@example.com" }];
    renderForm();
    expect(screen.getByText("ほかのアカウントにも入れる")).toBeTruthy();
    expect(screen.getByRole("switch", { name: /仕事用/ })).toBeTruthy();
  });

  it("編集画面でも出る(作る時に入れ忘れた予定を後から入れられるように)", () => {
    mocks.others = [{ userId: "work", dbName: "life-hub-work", label: "仕事用", email: "work@example.com" }];
    renderForm(existingEvent);
    expect(screen.getByRole("switch", { name: /仕事用/ })).toBeTruthy();
    // 相手側の同じ予定を直すものだと思われないよう、断り書きを出す。
    expect(screen.getByText(/新しく1件追加されます/)).toBeTruthy();
  });

  it("編集で保存し直しただけでは、相手のアカウントに増やさない", async () => {
    mocks.others = [{ userId: "work", dbName: "life-hub-work", label: "仕事用", email: "work@example.com" }];
    const user = userEvent.setup();
    renderForm(existingEvent);

    await user.click(screen.getByRole("button", { name: "変更を保存" }));

    expect(mocks.updated).toHaveLength(1);
    expect(mocks.copies).toEqual([]);
  });

  it("編集画面でチェックを入れて保存すると、相手のアカウントに1件足す", async () => {
    mocks.others = [{ userId: "work", dbName: "life-hub-work", label: "仕事用", email: "work@example.com" }];
    const user = userEvent.setup();
    renderForm(existingEvent);

    await user.click(screen.getByRole("switch", { name: /仕事用/ }));
    await user.click(screen.getByRole("button", { name: "変更を保存" }));

    expect(mocks.copies).toEqual([{ label: "仕事用", title: "面接" }]);
  });

  it("そのアカウントでの予定名だけ書き換えて入れられる", async () => {
    mocks.others = [{ userId: "work", dbName: "life-hub-work", label: "仕事用", email: "work@example.com" }];
    const user = userEvent.setup();
    renderForm(existingEvent);

    await user.click(screen.getByRole("switch", { name: /仕事用/ }));
    const perAccountTitle = screen.getByLabelText("このアカウントでの予定名");
    await user.clear(perAccountTitle);
    await user.type(perAccountTitle, "○○社 面接");
    await user.click(screen.getByRole("button", { name: "変更を保存" }));

    // こちらの予定名はそのまま、相手側だけ書き換えた名前で入る。
    expect(mocks.updated[0].title).toBe("面接");
    expect(mocks.copies).toEqual([{ label: "仕事用", title: "○○社 面接" }]);
  });
});
