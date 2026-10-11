/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../ui/ToastProvider";

const mocks = vi.hoisted(() => ({ sent: [] as unknown[], failWith: null as null | string }));

vi.mock("../../lib/appFeedback", async () => {
  const actual = await vi.importActual<typeof import("../../lib/appFeedback")>("../../lib/appFeedback");
  return {
    ...actual,
    sendFeedback: async (input: unknown) => {
      if (mocks.failWith) throw new actual.FeedbackError(mocks.failWith as never);
      mocks.sent.push(input);
    },
  };
});

import { FeedbackButton } from "./FeedbackButton";

function renderButton(props: { shareToken?: string } = {}, path = "/trips/abc") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <FeedbackButton {...props} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.sent = [];
  mocks.failWith = null;
  window.localStorage.clear();
});
afterEach(cleanup);

describe("修正ボタン", () => {
  it("押すと書く欄が開き、いまの画面と一緒に送る", async () => {
    const user = userEvent.setup();
    renderButton();
    expect(screen.getByRole("button", { name: "直してほしいことを送る" }).textContent).toContain("修正");
    await user.click(screen.getByRole("button", { name: "直してほしいことを送る" }));
    expect(screen.getByText(/いま開いている画面\(\/trips\/abc\)も一緒に送ります/)).toBeTruthy();
    const send = screen.getByRole("button", { name: "送る" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.type(screen.getByPlaceholderText(/時刻を変えても/), "並び順が戻らない");
    await user.type(screen.getByPlaceholderText(/えっくん/), "友人A");
    await user.click(screen.getByRole("button", { name: "送る" }));
    expect(mocks.sent).toEqual([{ message: "並び順が戻らない", page: "/trips/abc", senderName: "友人A", shareToken: undefined }]);
    expect(await screen.findByText("送りました。ありがとうございます")).toBeTruthy();
    // 名乗りは次から最初から入っている。
    await user.click(screen.getByRole("button", { name: "直してほしいことを送る" }));
    expect((screen.getByPlaceholderText(/えっくん/) as HTMLInputElement).value).toBe("友人A");
  });

  it("共有したしおりのページでは、合鍵も一緒に送る", async () => {
    const user = userEvent.setup();
    renderButton({ shareToken: "tok" }, "/share/trip/tok");
    await user.click(screen.getByRole("button", { name: "直してほしいことを送る" }));
    await user.type(screen.getByPlaceholderText(/時刻を変えても/), "x");
    await user.click(screen.getByRole("button", { name: "送る" }));
    expect(mocks.sent).toEqual([expect.objectContaining({ shareToken: "tok", page: "/share/trip/tok" })]);
  });

  it("送れなかった理由を、閉じずにそのまま出す", async () => {
    mocks.failWith = "unavailable";
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole("button", { name: "直してほしいことを送る" }));
    await user.type(screen.getByPlaceholderText(/時刻を変えても/), "x");
    await user.click(screen.getByRole("button", { name: "送る" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/準備中/);
    expect(screen.getByRole("button", { name: "送る" })).toBeTruthy();
  });
});
