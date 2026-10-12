/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TripPackingItem } from "../../types";
import { ConfirmProvider } from "../ui/ConfirmProvider";

const mocks = vi.hoisted(() => ({ updates: [] as [string, unknown][] }));
vi.mock("../../db/schema", () => ({
  db: { tripPackingItems: { update: async (id: string, patch: unknown) => void mocks.updates.push([id, patch]) } },
}));

import { LONG_PRESS_MS } from "../../hooks/useLongPressReorder";
import { TripPackingList } from "./TripPackingList";

function item(id: string, sortOrder?: number): TripPackingItem {
  return { id, tripId: "t", title: id, category: "essentials", checked: false, createdAt: 0, sortOrder };
}

/** jsdom は配置を計算しないので、行は上から 50px ずつ並んでいることにする(いまの DOM の並び順で)。 */
function layoutRows() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-reorder-row]"));
    const index = rows.indexOf(this);
    const top = index * 50;
    return { top, bottom: top + 40, height: 40, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

function rowOf(title: string): HTMLElement {
  return screen.getByRole("button", { name: `持ち物「${title}」を編集` }).closest("[data-reorder-row]") as HTMLElement;
}

function titles(): string[] {
  return Array.from(document.querySelectorAll("[data-reorder-row]")).map((row) => row.querySelector("button[title]")!.getAttribute("title")!);
}

/** jsdom には PointerEvent が無く、指の位置(clientY)や pointerId が渡らない。ブラウザと同じ形のものを用意する。 */
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  mocks.updates = [];
  vi.useFakeTimers();
  layoutRows();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderList(items: TripPackingItem[], onEdit = vi.fn()) {
  render(<TripPackingList items={items} onEdit={onEdit} onDelete={() => {}} />, { wrapper: ConfirmProvider });
  return onEdit;
}

describe("持ち物の長押しの並べ替え", () => {
  it("並べ替えた順に並ぶ", () => {
    renderList([item("充電器", 2), item("パスポート", 1), item("財布")]);
    expect(titles()).toEqual(["パスポート", "充電器", "財布"]);
  });

  it("長押ししてから下へ動かして離すと、その位置へ動き、番号を振り直す", async () => {
    renderList([item("パスポート", 1), item("充電器", 2), item("財布", 3)]);
    const row = rowOf("パスポート");
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    // 動いている間は、落とす位置に並び替えて見せる。
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 10, clientY: 140 });
    expect(titles()).toEqual(["充電器", "財布", "パスポート"]);
    await act(async () => {
      fireEvent.pointerUp(row, { pointerId: 1, clientX: 10, clientY: 140 });
    });
    expect(mocks.updates).toEqual([
      ["充電器", { sortOrder: 1 }],
      ["財布", { sortOrder: 2 }],
      ["パスポート", { sortOrder: 3 }],
    ]);
  });

  it("長押しになる前に指が動いたら、スクロールとして扱い、並べ替えない", async () => {
    renderList([item("パスポート", 1), item("充電器", 2)]);
    const row = rowOf("パスポート");
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 10, clientY: 60 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 10, clientY: 120 });
    await act(async () => {
      fireEvent.pointerUp(row, { pointerId: 1, clientX: 10, clientY: 120 });
    });
    expect(titles()).toEqual(["パスポート", "充電器"]);
    expect(mocks.updates).toEqual([]);
  });

  it("ふつうに押せば、これまでどおり編集が開く。並べ替えた直後の押しでは開かない", async () => {
    const onEdit = renderList([item("パスポート", 1), item("充電器", 2)]);
    fireEvent.click(screen.getByRole("button", { name: "持ち物「パスポート」を編集" }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    const row = rowOf("充電器");
    fireEvent.pointerDown(row, { pointerId: 2, button: 0, clientX: 10, clientY: 70 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    fireEvent.pointerMove(row, { pointerId: 2, clientX: 10, clientY: 5 });
    await act(async () => {
      fireEvent.pointerUp(row, { pointerId: 2, clientX: 10, clientY: 5 });
    });
    fireEvent.click(screen.getByRole("button", { name: "持ち物「充電器」を編集" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(mocks.updates).toEqual([
      ["充電器", { sortOrder: 1 }],
      ["パスポート", { sortOrder: 2 }],
    ]);
  });
});
