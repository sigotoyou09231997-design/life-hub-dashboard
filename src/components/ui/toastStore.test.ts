import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTION_TOAST_DURATION_MS,
  TOAST_DURATION_MS,
  dismissToast,
  flushToast,
  getToastSnapshot,
  pauseToast,
  resumeToast,
  runToastAction,
  showToast,
} from "./toastStore";

// UI/UX 調査メモ 第4弾 A-2: お知らせはボタン(元に戻す)を持てる。出ているのは常に1つで、
// どう消えても onClose を1回だけ呼ぶ(置き換えられた削除も、取りこぼさずに書き切るため)。

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  flushToast();
  vi.useRealTimers();
});

describe("お知らせ(toastStore)", () => {
  it("今までの呼び方(文・色)はそのまま。2.5秒で消える", () => {
    showToast("保存に失敗しました", "error");
    expect(getToastSnapshot()).toMatchObject({ message: "保存に失敗しました", tone: "error", duration: TOAST_DURATION_MS });
    expect(getToastSnapshot()?.actionLabel).toBeUndefined();

    vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    expect(getToastSnapshot()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(getToastSnapshot()).toBeNull();
  });

  it("ボタン付きは5秒出して、時間切れで onClose('timeout')", () => {
    const onClose = vi.fn();
    showToast("削除しました", { action: { label: "元に戻す", onClick: vi.fn() }, onClose });
    expect(getToastSnapshot()).toMatchObject({ actionLabel: "元に戻す", duration: ACTION_TOAST_DURATION_MS, tone: "success" });

    vi.advanceTimersByTime(ACTION_TOAST_DURATION_MS - 1);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("timeout");
    expect(getToastSnapshot()).toBeNull();
  });

  it("新しいお知らせは古いものを置き換え、古い方に onClose('replaced') を呼ぶ", () => {
    const onClose = vi.fn();
    showToast("削除しました", { action: { label: "元に戻す", onClick: vi.fn() }, onClose });
    showToast("保存しました");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("replaced");
    expect(getToastSnapshot()?.message).toBe("保存しました");
    // 置き換えた後に古い方の時間が来ても、もう呼ばない。
    vi.advanceTimersByTime(ACTION_TOAST_DURATION_MS);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ボタンを押すと、先に閉じて(onClose('action'))から働きを呼ぶ。働きが出したお知らせは残る", async () => {
    const order: string[] = [];
    const id = showToast("完了しました", {
      action: {
        label: "元に戻す",
        onClick: () => {
          order.push("click");
          showToast("元に戻しました");
        },
      },
      onClose: (reason) => order.push(`close:${reason}`),
    });

    runToastAction(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["close:action", "click"]);
    expect(getToastSnapshot()?.message).toBe("元に戻しました");
  });

  it("もう出ていないお知らせのボタン・消すは何もしない", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    const old = showToast("削除しました", { action: { label: "元に戻す", onClick }, onClose });
    vi.advanceTimersByTime(ACTION_TOAST_DURATION_MS);
    showToast("保存しました");

    runToastAction(old);
    expect(dismissToast(old)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getToastSnapshot()?.message).toBe("保存しました");
  });

  it("働きが失敗したら、そのことを知らせる", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = showToast("完了しました", {
      action: { label: "元に戻す", onClick: () => Promise.reject(new Error("db closed")) },
    });
    runToastAction(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(getToastSnapshot()).toMatchObject({ message: "元に戻せませんでした", tone: "error" });
    error.mockRestore();
  });

  it("指が乗っている間は時間を止め、離したら残りの時間だけ出す", () => {
    const onClose = vi.fn();
    const id = showToast("削除しました", { action: { label: "元に戻す", onClick: vi.fn() }, onClose });

    vi.advanceTimersByTime(2000);
    pauseToast(id);
    expect(getToastSnapshot()?.paused).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(onClose).not.toHaveBeenCalled();

    resumeToast(id);
    expect(getToastSnapshot()?.paused).toBe(false);
    vi.advanceTimersByTime(ACTION_TOAST_DURATION_MS - 2000 - 1);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("timeout");
  });

  it("flushToast は出ているお知らせをすぐ閉じる(画面が隠れた時)", () => {
    const onClose = vi.fn();
    showToast("削除しました", { action: { label: "元に戻す", onClick: vi.fn() }, onClose });
    flushToast();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("flushed");
    expect(getToastSnapshot()).toBeNull();
  });

  it("onClose の中で出したお知らせも、次のお知らせが来たら置き換えとして閉じる", () => {
    const inner = vi.fn();
    showToast("削除しました", {
      action: { label: "元に戻す", onClick: vi.fn() },
      onClose: () => void showToast("削除できませんでした", { tone: "error", onClose: inner }),
    });
    showToast("保存しました");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledWith("replaced");
    expect(getToastSnapshot()?.message).toBe("保存しました");
  });
});
