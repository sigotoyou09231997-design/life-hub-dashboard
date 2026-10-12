/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Task } from "../../types";
import { todayStr } from "../../lib/date";
import { ConfirmProvider } from "../ui/ConfirmProvider";
import { TaskItem } from "./TaskItem";

/** jsdom には PointerEvent が無い(src/components/ui/SwipeRow.test.tsx と同じ)。 */
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

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "牛乳を買う",
    priority: "medium",
    completed: false,
    repeat: "none",
    dueDate: todayStr(),
    createdAt: 0,
    ...overrides,
  } as Task;
}

function renderItem(props: Partial<Parameters<typeof TaskItem>[0]> = {}) {
  const onToggle = vi.fn();
  const onPostpone = vi.fn();
  const utils = render(
    <TaskItem
      task={task()}
      allTasks={[]}
      onToggle={onToggle}
      onEdit={() => {}}
      onDelete={() => {}}
      onAddSubtask={() => {}}
      onPostpone={onPostpone}
      {...props}
    />,
    { wrapper: ConfirmProvider },
  );
  return { ...utils, onToggle, onPostpone };
}

function swipeRow(row: HTMLElement, fromX: number, toX: number) {
  fireEvent.pointerDown(row, { pointerId: 1, pointerType: "touch", clientX: fromX, clientY: 20 });
  fireEvent.pointerMove(row, { pointerId: 1, pointerType: "touch", clientX: (fromX + toX) / 2, clientY: 20 });
  fireEvent.pointerMove(row, { pointerId: 1, pointerType: "touch", clientX: toX, clientY: 20 });
  fireEvent.pointerUp(row, { pointerId: 1, pointerType: "touch", clientX: toX, clientY: 20 });
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ top: 0, bottom: 60, left: 0, right: 300, width: 300, height: 60, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("タスクの完了の演出(A-4)", () => {
  it("チェックを押すと、取り消し線を引いてから完了を書き込む", () => {
    const { onToggle } = renderItem();
    fireEvent.click(screen.getByRole("button", { name: "完了切り替え" }));
    // 見た目はすぐ完了(チェックが付き、線を引き始める)。書き込みはまだ。
    expect(onToggle).not.toHaveBeenCalled();
    expect(document.querySelector(".task-strike.is-striking")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(420);
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("一覧から抜ける所では、行をたたんでから書き込む", () => {
    const { onToggle, container } = renderItem({ collapseOnComplete: true });
    fireEvent.click(screen.getByRole("button", { name: "完了切り替え" }));
    act(() => {
      vi.advanceTimersByTime(420);
    });
    expect(container.querySelector(".task-row--collapsing")).not.toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("演出の途中で押し直しても、2回書き込まない", () => {
    const { onToggle } = renderItem();
    const check = screen.getByRole("button", { name: "完了切り替え" });
    fireEvent.click(check);
    fireEvent.click(check);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("演出の途中で画面ごと消えても、完了にしたことは落とさない", () => {
    const { onToggle, unmount } = renderItem({ collapseOnComplete: true });
    fireEvent.click(screen.getByRole("button", { name: "完了切り替え" }));
    unmount();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("完了を戻す時は演出なしで、すぐ書き込む", () => {
    const { onToggle } = renderItem({ task: task({ completed: true }) });
    fireEvent.click(screen.getByRole("button", { name: "完了切り替え" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("動きを減らす設定の時は、待たずにすぐ完了にする", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    const { onToggle } = renderItem({ collapseOnComplete: true });
    fireEvent.click(screen.getByRole("button", { name: "完了切り替え" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("タスクのスワイプ(A-3)", () => {
  function row() {
    return screen.getByRole("button", { name: "タスク「牛乳を買う」を編集" });
  }

  it("右へ払うと完了(演出のあとに書き込む)", () => {
    const { onToggle } = renderItem();
    swipeRow(row(), 40, 220);
    act(() => {
      vi.advanceTimersByTime(420);
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("左へ払うと明日へ", () => {
    const { onPostpone, onToggle } = renderItem();
    swipeRow(row(), 260, 80);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onPostpone).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("先の日付のタスクは「明日へ」が無いので、左へは払えない", () => {
    const { onPostpone } = renderItem({ task: task({ dueDate: "2999-01-01" }) });
    swipeRow(row(), 260, 80);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onPostpone).not.toHaveBeenCalled();
  });

  it("払っただけでは編集を開かない", () => {
    const onEdit = vi.fn();
    renderItem({ onEdit });
    swipeRow(row(), 260, 230);
    fireEvent.click(row());
    expect(onEdit).not.toHaveBeenCalled();
  });
});
