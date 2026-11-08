// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOT_STALL_KEY, BOOT_STALL_MS, RETRY_GAP_MS, decideBootStall, useBootStallWatch } from "./bootStall";

/**
 * 2026-11-09「アプリを切り替えて戻ると真っ白から動かない」。起動の待ちに上限が無く、iPhone が止めた通信を
 * 永久に待っていた。待ちが続いたら1回だけ読み込み直し、それでも止まればボタンを出す(白いままにしない)ことを見張る。
 */
describe("decideBootStall", () => {
  it("前に読み込み直していなければ、読み込み直す", () => {
    expect(decideBootStall(null, 1_000_000)).toBe("reload");
  });
  it("読み込み直したばかり(RETRY_GAP_MS 以内)なら、繰り返さずにあきらめる", () => {
    expect(decideBootStall(1_000_000, 1_000_000 + RETRY_GAP_MS - 1)).toBe("giveup");
  });
  it("前の読み込み直しから十分たっていれば、また読み込み直す", () => {
    expect(decideBootStall(1_000_000, 1_000_000 + RETRY_GAP_MS)).toBe("reload");
  });
});

describe("useBootStallWatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("待ちが BOOT_STALL_MS 続くと、1回だけ読み込み直す", () => {
    const reload = vi.fn();
    renderHook(() => useBootStallWatch(true, reload));
    act(() => void vi.advanceTimersByTime(BOOT_STALL_MS - 1000));
    expect(reload).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2000));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(BOOT_STALL_KEY)).not.toBeNull();
    act(() => void vi.advanceTimersByTime(BOOT_STALL_MS * 3));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("読み込み直したばかりでまた止まったら、読み込み直さずに true(ボタンを出す)を返す", () => {
    window.sessionStorage.setItem(BOOT_STALL_KEY, String(Date.now()));
    const reload = vi.fn();
    const { result } = renderHook(() => useBootStallWatch(true, reload));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(BOOT_STALL_MS + 1000));
    expect(reload).not.toHaveBeenCalled();
    expect(result.current).toBe(true);
  });

  it("待ちが終われば何もしない", () => {
    const reload = vi.fn();
    const { rerender } = renderHook(({ waiting }) => useBootStallWatch(waiting, reload), { initialProps: { waiting: true } });
    act(() => void vi.advanceTimersByTime(BOOT_STALL_MS / 2));
    rerender({ waiting: false });
    act(() => void vi.advanceTimersByTime(BOOT_STALL_MS * 2));
    expect(reload).not.toHaveBeenCalled();
  });

  it("画面が隠れている間は数えない", () => {
    const reload = vi.fn();
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderHook(() => useBootStallWatch(true, reload));
    act(() => void vi.advanceTimersByTime(BOOT_STALL_MS * 3));
    expect(reload).not.toHaveBeenCalled();
    spy.mockReturnValue("visible");
    act(() => void vi.advanceTimersByTime(BOOT_STALL_MS + 1000));
    expect(reload).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
