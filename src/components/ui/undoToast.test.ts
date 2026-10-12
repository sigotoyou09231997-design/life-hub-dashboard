// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitPendingDeletes, isPendingDelete } from "../../lib/deferredDelete";
import { flushToast, getToastSnapshot, runToastAction, showToast } from "./toastStore";
import { UNDO_DURATION_MS, deleteWithUndo, quoted, showUndoToast } from "./undoToast";

// UI/UX 調査メモ 第4弾 A-2: 「削除しました・元に戻す」。押した時は隠すだけで、本当に消すのは
// お知らせが時間切れ・次のお知らせに置き換わった・画面が隠れた時。元に戻すは DB を触らない。

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  flushToast();
  await commitPendingDeletes();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
});

function currentToastId(): number {
  const toast = getToastSnapshot();
  if (!toast) throw new Error("お知らせが出ていない");
  return toast.id;
}

describe("削除しました・元に戻す(deleteWithUndo)", () => {
  it("押した時は隠すだけ。5秒たってお知らせが閉じた時に、本当に消す", async () => {
    const commit = vi.fn(async () => {});
    deleteWithUndo([{ table: "tasks", id: "t1" }], commit, "「牛乳を買う」を削除しました");

    expect(getToastSnapshot()).toMatchObject({ message: "「牛乳を買う」を削除しました", actionLabel: "元に戻す" });
    expect(isPendingDelete("tasks", "t1")).toBe(true);
    expect(commit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(UNDO_DURATION_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("元に戻すを押すと、消さずに一覧へ戻す(「元に戻しました」と出す)", async () => {
    const commit = vi.fn(async () => {});
    deleteWithUndo([{ table: "notes", id: "n1" }], commit);

    runToastAction(currentToastId());
    expect(isPendingDelete("notes", "n1")).toBe(false);
    expect(getToastSnapshot()?.message).toBe("元に戻しました");

    await vi.advanceTimersByTimeAsync(UNDO_DURATION_MS * 2);
    expect(commit).not.toHaveBeenCalled();
  });

  it("次のお知らせに置き換わったら、前の削除はその場で書き切る(元に戻すはもう出ない)", async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    deleteWithUndo([{ table: "tasks", id: "a" }], first, "「A」を削除しました");
    deleteWithUndo([{ table: "tasks", id: "b" }], second, "「B」を削除しました");

    await vi.advanceTimersByTimeAsync(0);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(getToastSnapshot()?.message).toBe("「B」を削除しました");

    // 今出ている方を戻しても、前の方は戻らない(もう消してある)。
    runToastAction(currentToastId());
    expect(isPendingDelete("tasks", "b")).toBe(false);
    expect(second).not.toHaveBeenCalled();
  });

  it("文だけのお知らせに置き換わっても、前の削除は書き切る", async () => {
    const commit = vi.fn(async () => {});
    deleteWithUndo([{ table: "tasks", id: "a" }], commit);
    showToast("保存しました");
    await vi.advanceTimersByTimeAsync(0);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("画面が隠れたら(pagehide)、お知らせが出ている途中でも書き切る", async () => {
    const commit = vi.fn(async () => {});
    deleteWithUndo([{ table: "tasks", id: "a" }], commit);

    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(commit).toHaveBeenCalledTimes(1);

    // お知らせが閉じる時(ここでは時間切れ)にもう一度呼ばれても、消すのは1回だけ。
    await vi.advanceTimersByTimeAsync(UNDO_DURATION_MS);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("消すのに失敗したら、行を戻して「削除できませんでした」と出す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    deleteWithUndo([{ table: "tasks", id: "a" }], async () => {
      throw new Error("db closed");
    });
    await vi.advanceTimersByTimeAsync(UNDO_DURATION_MS);
    expect(isPendingDelete("tasks", "a")).toBe(false);
    expect(getToastSnapshot()).toMatchObject({ message: "削除できませんでした", tone: "error" });
    error.mockRestore();
  });
});

describe("済ませた変更の元に戻す(showUndoToast)", () => {
  it("元に戻すを押すと逆の変更を呼び、終わってから「元に戻しました」と出す", async () => {
    const undo = vi.fn(async () => {});
    showUndoToast("「牛乳を買う」を完了しました", undo);
    expect(getToastSnapshot()).toMatchObject({ actionLabel: "元に戻す", duration: UNDO_DURATION_MS });

    runToastAction(currentToastId());
    await vi.advanceTimersByTimeAsync(0);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(getToastSnapshot()?.message).toBe("元に戻しました");
  });

  it("押さずに時間が過ぎれば、何もしない", async () => {
    const undo = vi.fn();
    showUndoToast("期日を明日にしました", undo);
    await vi.advanceTimersByTimeAsync(UNDO_DURATION_MS);
    expect(undo).not.toHaveBeenCalled();
    expect(getToastSnapshot()).toBeNull();
  });
});

describe("お知らせの中の名前(quoted)", () => {
  it("「」で囲み、長い題名は縮める。空なら空文字", () => {
    expect(quoted("牛乳を買う")).toBe("「牛乳を買う」");
    expect(quoted("とても長いタスクの名前でお知らせに入りきらない")).toBe("「とても長いタスク…」");
    expect(quoted("請求書をまとめて送る")).toBe("「請求書をまとめて…」");
    expect(quoted("  ")).toBe("");
    expect(quoted(undefined)).toBe("");
  });
});
