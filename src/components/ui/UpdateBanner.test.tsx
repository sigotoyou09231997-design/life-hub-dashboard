/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

/** 切り替え（Service Worker の差し替え）の代わり。呼ばれた回数＝切り替えた回数。 */
const applyUpdate = vi.fn(() => Promise.resolve());

/**
 * 各テストで pwaUpdate のモジュール状態(更新済みフラグ)と、帯の「開いた時刻」を作り直す。
 *
 * 2026-10-12: 以前は vi.mock(importOriginal) で applyUpdate だけ差し替えていたが、
 * importOriginal が返す本物は resetModules をまたいで使い回されるため、1つ目のテストで
 * 立てた「更新あり」が次のテストに残っていた（どのテストも最初に更新を起こしていたので
 * 表に出なかった）。本物をそのまま読み直し、切り替えの中身だけ setUpdateApplier で偽物にする。
 */
async function freshBanner() {
  vi.resetModules();
  const pwaUpdate = await import("../../lib/pwaUpdate");
  pwaUpdate.setUpdateApplier(applyUpdate);
  const { UpdateBanner } = await import("./UpdateBanner");
  return { pwaUpdate, UpdateBanner };
}

/** 帯が待つ時間 = プログレスバー1500ms + 150ms。 */
const UNTIL_APPLY_MS = 1700;

beforeEach(() => {
  vi.useFakeTimers();
  applyUpdate.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.style.overflow = "";
  setVisibility("visible");
});

/** ほかのアプリ・タブへ移った／戻ってきた、を起こす。 */
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** 「開いてすぐ」の15秒を過ぎて、使っている途中にする。 */
async function useForAWhile() {
  // 「開いてすぐ」は Date.now() で測っているので、時計も進める（タイマーを進めるだけでは Date は動かない）。
  vi.setSystemTime(Date.now() + 20_000);
  await act(async () => {
    vi.advanceTimersByTime(20_000);
  });
}

describe("UpdateBanner", () => {
  it("開いてすぐに見つかった更新は、その場で帯を出して切り替える", async () => {
    const { pwaUpdate, UpdateBanner } = await freshBanner();
    render(<UpdateBanner />);
    expect(screen.queryByText("アップデートが来ています")).toBeNull();

    // クリックもキー入力も起こさずに知らせが来るだけ。
    act(() => pwaUpdate.markUpdateAvailable());
    expect(screen.getByText("アップデートが来ています")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(UNTIL_APPLY_MS);
    });
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("フォームを開いている間は切り替えを待ち、閉じたら適用する", async () => {
    const { pwaUpdate, UpdateBanner } = await freshBanner();
    document.body.style.overflow = "hidden"; // Sheetが開いている状態
    render(<UpdateBanner />);
    act(() => pwaUpdate.markUpdateAvailable());

    await act(async () => {
      vi.advanceTimersByTime(UNTIL_APPLY_MS);
    });
    expect(applyUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("入力が終わったら切り替えます")).toBeTruthy();

    document.body.style.overflow = "";
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("フォームを開いたままでも、5分待ったところで打ち切って切り替える", async () => {
    const { pwaUpdate, UpdateBanner } = await freshBanner();
    document.body.style.overflow = "hidden";
    render(<UpdateBanner />);
    act(() => pwaUpdate.markUpdateAvailable());

    await act(async () => {
      vi.advanceTimersByTime(UNTIL_APPLY_MS + 4 * 60_000);
    });
    expect(applyUpdate).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("使っている途中に来た更新は、帯も切り替えもしない。何回来ても、画面を離れた時に1回だけ切り替える", async () => {
    const { pwaUpdate, UpdateBanner } = await freshBanner();
    render(<UpdateBanner />);
    await useForAWhile();

    act(() => pwaUpdate.markUpdateAvailable());
    act(() => pwaUpdate.markUpdateAvailable()); // 続けてもう1回出した
    await act(async () => {
      vi.advanceTimersByTime(60 * 60_000);
    });
    expect(screen.queryByText("アップデートが来ています")).toBeNull();
    expect(applyUpdate).not.toHaveBeenCalled();

    act(() => setVisibility("hidden"));
    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("アップデートが来ています")).toBeNull();
  });

  it("入力のシートを開いたまま離れた時は切り替えず、次に離れた時に切り替える", async () => {
    const { pwaUpdate, UpdateBanner } = await freshBanner();
    render(<UpdateBanner />);
    await useForAWhile();
    act(() => pwaUpdate.markUpdateAvailable());

    document.body.style.overflow = "hidden"; // Sheetが開いている状態
    act(() => setVisibility("hidden"));
    expect(applyUpdate).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    document.body.style.overflow = "";
    act(() => setVisibility("hidden"));
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("裏に回したタブで見つかった更新は、その場で黙って切り替える", async () => {
    const { pwaUpdate, UpdateBanner } = await freshBanner();
    render(<UpdateBanner />);
    await useForAWhile();
    setVisibility("hidden");

    act(() => pwaUpdate.markUpdateAvailable());
    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("アップデートが来ています")).toBeNull();
  });

  it("開きっぱなしで3時間たったら、1回だけ帯を出して切り替える", async () => {
    const { pwaUpdate, UpdateBanner } = await freshBanner();
    render(<UpdateBanner />);
    await useForAWhile();
    act(() => pwaUpdate.markUpdateAvailable());

    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 60_000);
    });
    expect(screen.getByText("アップデートが来ています")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(UNTIL_APPLY_MS);
    });
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });
});
