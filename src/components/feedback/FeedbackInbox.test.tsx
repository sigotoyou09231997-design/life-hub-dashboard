/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../ui/ToastProvider";
import type { FeedbackItem } from "../../lib/appFeedback";

const mocks = vi.hoisted(() => ({
  owner: false,
  items: [] as FeedbackItem[],
  changed: [] as [string, string][],
}));

vi.mock("../../lib/appFeedback", async () => {
  const actual = await vi.importActual<typeof import("../../lib/appFeedback")>("../../lib/appFeedback");
  return {
    ...actual,
    loadIsFeedbackOwner: async () => mocks.owner,
    loadFeedback: async () => mocks.items,
    setFeedbackStatus: async (id: string, status: string) => void mocks.changed.push([id, status]),
  };
});

import { FeedbackInbox } from "./FeedbackInbox";

function item(overrides: Partial<FeedbackItem>): FeedbackItem {
  return { id: "f1", via: "app", message: "ボタンが小さい", status: "new", createdAt: "2026-10-11T03:00:00Z", ...overrides };
}

function renderInbox() {
  render(
    <ToastProvider>
      <FeedbackInbox />
    </ToastProvider>,
  );
}

beforeEach(() => {
  mocks.owner = false;
  mocks.items = [];
  mocks.changed = [];
});
afterEach(cleanup);

describe("届いた要望", () => {
  it("持ち主でなければ、何も出さない", async () => {
    mocks.items = [item({})];
    renderInbox();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("届いた要望")).toBeNull();
  });

  it("持ち主には、未対応の要望を誰から・どの画面かと一緒に並べる", async () => {
    mocks.owner = true;
    mocks.items = [
      item({ id: "a", senderName: "友人A", page: "/trips/x", message: "並び順が戻らない" }),
      item({ id: "b", via: "share", tripName: "四国旅行", message: "しおりの時刻が違う" }),
      item({ id: "c", status: "done", message: "直したもの" }),
    ];
    renderInbox();
    expect(await screen.findByText("未対応 2件")).toBeTruthy();
    expect(screen.getByText("並び順が戻らない")).toBeTruthy();
    expect(screen.getByText(/友人A ・ \/trips\/x/)).toBeTruthy();
    expect(screen.getByText(/しおりを見た人\(「四国旅行」のしおりから\)/)).toBeTruthy();
    expect(screen.queryByText("直したもの")).toBeNull();
  });

  it("対応済みにすると一覧から外れ、「対応済みも見る」で見られる", async () => {
    mocks.owner = true;
    mocks.items = [item({ id: "a", message: "並び順が戻らない" })];
    const user = userEvent.setup();
    renderInbox();
    await user.click(await screen.findByRole("button", { name: "対応済みにする" }));
    expect(mocks.changed).toEqual([["a", "done"]]);
    await waitFor(() => expect(screen.queryByText("並び順が戻らない")).toBeNull());
    await user.click(screen.getByRole("button", { name: "対応済み・見送りも見る" }));
    expect(screen.getByText("並び順が戻らない")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "未対応に戻す" }));
    expect(mocks.changed).toEqual([["a", "done"], ["a", "new"]]);
  });
});
