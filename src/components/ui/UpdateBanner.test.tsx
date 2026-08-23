/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const applyUpdate = vi.fn(() => Promise.resolve());

vi.mock("../../lib/pwaUpdate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/pwaUpdate")>();
  return { ...actual, applyUpdate };
});

/** 各テストで pwaUpdate のモジュール状態(更新済みフラグ)を作り直す。 */
async function freshBanner() {
  vi.resetModules();
  const pwaUpdate = await import("../../lib/pwaUpdate");
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
});

describe("UpdateBanner", () => {
  it("画面を触っていなくても、更新が見つかった時点で帯を出して切り替える", async () => {
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
});
