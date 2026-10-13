/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../ui/ToastProvider";
import type { FeedbackItem } from "../../lib/appFeedback";

const mocks = vi.hoisted(() => ({ recent: [] as FeedbackItem[], owner: false as boolean | undefined }));

vi.mock("../../lib/appFeedback", async () => {
  const actual = await vi.importActual<typeof import("../../lib/appFeedback")>("../../lib/appFeedback");
  return {
    ...actual,
    canAttachImages: async () => false,
    loadRecentFeedback: async () => mocks.recent,
  };
});
vi.mock("../../hooks/useIsFeedbackOwner", () => ({ useIsFeedbackOwner: () => mocks.owner }));

import { notifyFeedbackChanged } from "../../lib/appFeedback";
import { resetFeedbackProgressForTests } from "../../lib/feedbackProgress";
import { FeedbackButton, InAppFeedbackButton } from "./FeedbackButton";

const item = (id: string, status: FeedbackItem["status"], extra: Partial<FeedbackItem> = {}): FeedbackItem => ({
  id,
  via: "app",
  message: "ボタンが小さくて押しにくい",
  status,
  createdAt: "2026-10-13T03:00:00Z",
  ...extra,
});

function renderApp(ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/trips"]}>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetFeedbackProgressForTests();
  mocks.recent = [];
  mocks.owner = false;
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  resetFeedbackProgressForTests();
});

describe("修正ボタンの「修正中」", () => {
  it("直してもらっている依頼が無い間は、いつもの「修正」", async () => {
    renderApp(<FeedbackButton />);
    const button = screen.getByRole("button", { name: "直してほしいことを送る" });
    expect(button.textContent).toBe("修正");
  });

  it("修正中の依頼がある間は、「修正中」に変わる。終わると「修正」に戻る", async () => {
    mocks.recent = [item("a", "working", { workingAt: "2026-10-13T03:10:00Z" })];
    renderApp(<FeedbackButton />);
    const button = await screen.findByRole("button", { name: "修正中です。直してほしいことを送る" });
    expect(button.textContent).toBe("修正中");

    mocks.recent = [item("a", "done")];
    await act(async () => notifyFeedbackChanged());
    await waitFor(() => expect(screen.getByRole("button", { name: "直してほしいことを送る" }).textContent).toBe("修正"));
  });

  it("受け付け済みだけ(まだ手を付けていない)の間は、「修正中」にしない", async () => {
    mocks.recent = [item("a", "new")];
    renderApp(<FeedbackButton />);
    await screen.findByRole("button", { name: "直してほしいことを送る" });
    expect(screen.queryByText("修正中")).toBeNull();
  });

  it("開くと、送った依頼の状況が出る(受け付け済み・修正中とその時刻・対応済み)", async () => {
    const user = userEvent.setup();
    mocks.recent = [
      item("a", "working", { workingAt: "2026-10-13T03:10:00Z", message: "地図が出ない" }),
      item("b", "new", { message: "文字が小さい" }),
      item("c", "done", { message: "色が見にくい" }),
    ];
    renderApp(<FeedbackButton />);
    await user.click(await screen.findByRole("button", { name: "修正中です。直してほしいことを送る" }));
    const list = await screen.findByRole("region", { name: "送った依頼の状況" });
    expect(list.textContent).toContain("地図が出ない");
    expect(list.textContent).toMatch(/\d+\/\d+ \d+:\d{2} から修正中/);
    expect(list.textContent).toContain("受け付け済み");
    expect(list.textContent).toContain("対応済み");
  });

  it("何も送っていなければ、状況の一覧は出さない。共有ページ(ログインなし)にも出さない", async () => {
    const user = userEvent.setup();
    renderApp(<FeedbackButton />);
    await user.click(screen.getByRole("button", { name: "直してほしいことを送る" }));
    expect(screen.queryByRole("region", { name: "送った依頼の状況" })).toBeNull();
    cleanup();
    mocks.recent = [item("a", "working")];
    renderApp(<FeedbackButton shareToken="abc" standalone />);
    await user.click(await screen.findByRole("button", { name: /直してほしいことを送る/ }));
    expect(screen.queryByRole("region", { name: "送った依頼の状況" })).toBeNull();
  });
});

describe("持ち主の画面(2026-10-13、本人「修正を送るボタンが消えてる」)", () => {
  it("持ち主にも、アプリの「修正」ボタンを出す", async () => {
    mocks.owner = true;
    renderApp(<InAppFeedbackButton />);
    expect(screen.getByRole("button", { name: "直してほしいことを送る" }).textContent).toBe("修正");
  });

  it("持ち主でない人にも、持ち主かまだ分からない間も、出す", async () => {
    mocks.owner = false;
    renderApp(<InAppFeedbackButton />);
    expect(screen.getByRole("button", { name: "直してほしいことを送る" })).toBeTruthy();
    cleanup();
    mocks.owner = undefined;
    renderApp(<InAppFeedbackButton />);
    expect(screen.getByRole("button", { name: "直してほしいことを送る" })).toBeTruthy();
  });

  it("持ち主の「修正」も、誰かの依頼を直している間は「修正中」になる。開くと、届いている依頼の状況が出る", async () => {
    const user = userEvent.setup();
    mocks.owner = true;
    mocks.recent = [item("a", "working", { workingAt: "2026-10-13T03:10:00Z", message: "地図が出ない" }), item("b", "new", { message: "文字が小さい" })];
    renderApp(<InAppFeedbackButton />);
    const button = await screen.findByRole("button", { name: "修正中です。直してほしいことを送る" });
    expect(button.textContent).toBe("修正中");
    await user.click(button);
    const list = await screen.findByRole("region", { name: "届いている依頼の状況" });
    expect(list.textContent).toContain("地図が出ない");
    expect(list.textContent).toContain("文字が小さい");
    expect(screen.queryByRole("region", { name: "送った依頼の状況" })).toBeNull();
  });
});
