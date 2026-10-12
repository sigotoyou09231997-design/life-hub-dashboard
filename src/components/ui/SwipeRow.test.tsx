/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Check, Trash2 } from "lucide-react";
import { SwipeRow, type SwipeAction } from "./SwipeRow";

/** jsdom には PointerEvent が無く、指の位置・pointerId・指かマウスか(pointerType)が渡らない。ブラウザと同じ形のものを用意する
 * (src/components/trips/TripPackingList.test.tsx と同じ)。 */
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "touch";
    this.isPrimary = init.isPrimary ?? true;
  }
}

const ROW_WIDTH = 300;

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.useFakeTimers();
  // jsdom は配置を計算しないので、行の幅は 300px ということにする。
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ top: 0, bottom: 60, left: 0, right: ROW_WIDTH, width: ROW_WIDTH, height: 60, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function action(overrides: Partial<SwipeAction> = {}): SwipeAction {
  return { label: "削除", icon: Trash2, tone: "danger", after: "leave", onCommit: vi.fn(), ...overrides };
}

function renderRow(props: { left?: SwipeAction; right?: SwipeAction; disabled?: boolean } = {}, onClick = vi.fn()) {
  const utils = render(
    <SwipeRow {...props}>
      <button type="button" onClick={onClick}>
        牛乳
      </button>
    </SwipeRow>,
  );
  const row = screen.getByRole("button", { name: "牛乳" });
  return { ...utils, row, root: row.closest(".swipe-row") as HTMLElement, onClick };
}

/** 指で (x0, y) から (x1, y1) まで動かして離す。 */
function swipe(target: HTMLElement, from: { x: number; y?: number }, to: { x: number; y?: number }, pointerType = "touch") {
  const y0 = from.y ?? 30;
  const y1 = to.y ?? y0;
  fireEvent.pointerDown(target, { pointerId: 1, pointerType, isPrimary: true, button: 0, clientX: from.x, clientY: y0 });
  // 途中の点も通す(向きは最初の 10px で決まる)。
  fireEvent.pointerMove(target, { pointerId: 1, pointerType, clientX: from.x + (to.x - from.x) / 4, clientY: y0 + (y1 - y0) / 4 });
  fireEvent.pointerMove(target, { pointerId: 1, pointerType, clientX: to.x, clientY: y1 });
  fireEvent.pointerUp(target, { pointerId: 1, pointerType, clientX: to.x, clientY: y1 });
}

describe("SwipeRow", () => {
  it("左へ行の幅の 38% 以上払うと、行が抜けてから操作する", () => {
    const left = action();
    const { row, root } = renderRow({ left });
    swipe(row, { x: 250 }, { x: 120 });
    // 抜けている途中はまだ操作しない(行が消えるのを見せてから)。
    expect(left.onCommit).not.toHaveBeenCalled();
    expect(root.dataset.swipeState).toBe("leaving");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(left.onCommit).toHaveBeenCalledTimes(1);
  });

  it("払っている間は、行の下に色と文字が見える", () => {
    const { row, root } = renderRow({ left: action() });
    fireEvent.pointerDown(row, { pointerId: 1, pointerType: "touch", clientX: 250, clientY: 30 });
    fireEvent.pointerMove(row, { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 30 });
    expect(root.dataset.swipeState).toBe("dragging");
    expect(root.dataset.swipeSide).toBe("left");
    expect(root.querySelector(".swipe-row__under--danger")?.textContent).toBe("削除");
    // まだ「離せば決まる」所の手前。
    expect(root.dataset.swipeArmed).toBeUndefined();
    fireEvent.pointerMove(row, { pointerId: 1, pointerType: "touch", clientX: 120, clientY: 30 });
    expect(root.dataset.swipeArmed).toBe("true");
  });

  it("手前で離すと元に戻り、操作しない", () => {
    const left = action();
    const { row, root } = renderRow({ left });
    swipe(row, { x: 250 }, { x: 200 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(left.onCommit).not.toHaveBeenCalled();
    expect(root.dataset.swipeState).toBe("idle");
    expect((root.querySelector(".swipe-row__surface") as HTMLElement).style.transform).toBe("");
  });

  it("縦に動いた指はスクロールとして画面に任せる", () => {
    const left = action();
    const { row, root } = renderRow({ left });
    swipe(row, { x: 250, y: 30 }, { x: 120, y: 400 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(left.onCommit).not.toHaveBeenCalled();
    expect(root.dataset.swipeState).toBe("idle");
  });

  it("マウスでは払えない(パソコンは行のボタンで操作する)", () => {
    const left = action();
    const { row } = renderRow({ left });
    swipe(row, { x: 250 }, { x: 40 }, "mouse");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(left.onCommit).not.toHaveBeenCalled();
  });

  it("画面の左端から触り始めた指は使わない(iPhone の「戻る」)", () => {
    const right = action({ after: "return" });
    const { row } = renderRow({ right });
    swipe(row, { x: 8 }, { x: 260 });
    expect(right.onCommit).not.toHaveBeenCalled();
  });

  it("払い終えた後の「押した」は捨てる(払っただけで行が開かない)", () => {
    const { row, onClick } = renderRow({ left: action() });
    swipe(row, { x: 250 }, { x: 200 });
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
    // しばらくたてば、ふつうに押せる。
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("動かさずに押しただけなら、ふつうに押せる", () => {
    const left = action();
    const { row, onClick } = renderRow({ left });
    fireEvent.pointerDown(row, { pointerId: 1, pointerType: "touch", clientX: 150, clientY: 30 });
    fireEvent.pointerUp(row, { pointerId: 1, pointerType: "touch", clientX: 152, clientY: 31 });
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(left.onCommit).not.toHaveBeenCalled();
  });

  it("「戻す」操作は、離した時にすぐ操作して元の位置へ戻る", () => {
    const right = action({ label: "完了", icon: Check, tone: "complete", after: "return" });
    const { row, root } = renderRow({ right });
    swipe(row, { x: 40 }, { x: 200 });
    expect(right.onCommit).toHaveBeenCalledTimes(1);
    expect(root.dataset.swipeState).toBe("settling");
  });

  it("操作の無い向きへは払っても何も起きない", () => {
    const right = action({ after: "return" });
    const { row } = renderRow({ right });
    swipe(row, { x: 280 }, { x: 20 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(right.onCommit).not.toHaveBeenCalled();
  });

  it("抜けている途中で画面ごと消えても、操作は済ませる", () => {
    const left = action();
    const { row, unmount } = renderRow({ left });
    swipe(row, { x: 250 }, { x: 60 });
    unmount();
    expect(left.onCommit).toHaveBeenCalledTimes(1);
  });

  it("disabled の行は払えず、touch-action も付けない", () => {
    const left = action();
    const { row, root } = renderRow({ left, disabled: true });
    expect(root.className).not.toContain("swipe-row--enabled");
    swipe(row, { x: 250 }, { x: 40 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(left.onCommit).not.toHaveBeenCalled();
  });

  it("動きを減らす設定の時は、抜ける動きを待たずにすぐ操作する", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    const left = action();
    const { row } = renderRow({ left });
    swipe(row, { x: 250 }, { x: 60 });
    expect(left.onCommit).toHaveBeenCalledTimes(1);
  });
});
