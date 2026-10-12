/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "./ToastProvider";
import { getToastSnapshot, showToast } from "./toastStore";
import { deleteWithUndo } from "./undoToast";
import { commitPendingDeletes, isPendingDelete } from "../../lib/deferredDelete";

// UI/UX 調査メモ 第4弾 A-2: 「元に戻す」は押せる本物のボタンで、残り時間を下の線で見せる。

afterEach(async () => {
  cleanup();
  await commitPendingDeletes();
  vi.useRealTimers();
});

function SaveButton() {
  const showToast = useToast();
  return (
    <button type="button" onClick={() => showToast("保存しました")}>
      保存
    </button>
  );
}

describe("お知らせの置き場(ToastProvider)", () => {
  it("useToast の今までの呼び方で、文だけのお知らせが出る(ボタンも線も無い)", () => {
    render(<SaveButton />, { wrapper: ToastProvider });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("保存しました");
    expect(screen.queryByRole("button", { name: "元に戻す" })).toBeNull();
    expect(status.querySelector(".undo-toast__bar")).toBeNull();
  });

  it("画面の外から出した「元に戻す」付きのお知らせを描き、押すと戻る", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    render(<p>一覧</p>, { wrapper: ToastProvider });

    act(() => {
      deleteWithUndo([{ table: "tasks", id: "t1" }], commit, "「牛乳を買う」を削除しました");
    });
    expect(screen.getByText("「牛乳を買う」を削除しました")).toBeTruthy();
    const bar = screen.getByRole("status").querySelector<HTMLElement>(".undo-toast__bar");
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute("aria-hidden")).toBe("true");
    expect(bar!.style.getPropertyValue("--undo-toast-duration")).toBe("5000ms");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    });
    expect(isPendingDelete("tasks", "t1")).toBe(false);
    expect(screen.getByText("元に戻しました")).toBeTruthy();
    expect(commit).not.toHaveBeenCalled();
  });

  it("指が乗っている間は線も止める", () => {
    render(<p>一覧</p>, { wrapper: ToastProvider });
    act(() => {
      showToast("期日を明日にしました", { action: { label: "元に戻す", onClick: () => {} } });
    });
    const toast = screen.getByText("期日を明日にしました").parentElement!;
    act(() => {
      fireEvent.pointerEnter(toast);
    });
    expect(toast.querySelector(".undo-toast__bar")!.classList.contains("is-paused")).toBe(true);
    act(() => {
      fireEvent.pointerLeave(toast);
    });
    expect(toast.querySelector(".undo-toast__bar")!.classList.contains("is-paused")).toBe(false);
  });

  it("「元に戻す」付きの時だけ、置き場に印を付ける(スマホで右下の＋を避けるため)", () => {
    render(<p>一覧</p>, { wrapper: ToastProvider });
    act(() => {
      showToast("保存しました");
    });
    expect(screen.getByRole("status").classList.contains("undo-toast-region--action")).toBe(false);
    act(() => {
      showToast("完了しました", { action: { label: "元に戻す", onClick: () => {} } });
    });
    expect(screen.getByRole("status").classList.contains("undo-toast-region--action")).toBe(true);
  });

  it("置き場が無くなる時は、待っている削除を書き切ってお知らせを閉じる", async () => {
    const commit = vi.fn();
    const { unmount } = render(<p>一覧</p>, { wrapper: ToastProvider });
    act(() => {
      deleteWithUndo([{ table: "notes", id: "n1" }], commit);
    });
    unmount();
    await Promise.resolve();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(getToastSnapshot()).toBeNull();
  });
});
