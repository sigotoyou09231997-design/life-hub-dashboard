// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../types";

// UI/UX 調査メモ 第4弾 A-2: タスクの完了・先送り・削除には、5秒間「元に戻す」が出る。
// 削除は押した時に隠すだけで、DB から消すのはお知らせが閉じた時(src/lib/deferredDelete.ts)。

const mocks = vi.hoisted(() => ({
  rows: new Map<string, Task>(),
  deleted: [] as string[],
  reminderDeletes: [] as string[],
  nextId: 0,
}));

vi.mock("../../db/schema", () => {
  const children = (parentId: string) => [...mocks.rows.values()].filter((t) => t.parentTaskId === parentId);
  return {
    db: {
      tasks: {
        get: async (id: string) => mocks.rows.get(id),
        update: async (id: string, changes: Partial<Task>) => {
          const row = mocks.rows.get(id);
          if (!row) return 0;
          const next: Task = { ...row };
          for (const [key, value] of Object.entries(changes)) {
            // Dexie と同じく、undefined を渡した項目は消す。
            if (value === undefined) delete (next as unknown as Record<string, unknown>)[key];
            else (next as unknown as Record<string, unknown>)[key] = value;
          }
          mocks.rows.set(id, next);
          return 1;
        },
        add: async (row: Task) => {
          mocks.nextId += 1;
          const id = `new-${mocks.nextId}`;
          mocks.rows.set(id, { ...row, id });
          return id;
        },
        delete: async (id: string) => {
          mocks.deleted.push(id);
          mocks.rows.delete(id);
        },
        bulkDelete: async (ids: string[]) => {
          for (const id of ids) {
            mocks.deleted.push(id);
            mocks.rows.delete(id);
          }
        },
        where: () => ({
          equals: (parentId: string) => ({
            toArray: async () => children(parentId),
            primaryKeys: async () => children(parentId).map((t) => t.id!),
          }),
        }),
      },
    },
  };
});

vi.mock("../../lib/placeReminders", () => ({
  deletePlaceRemindersFor: async (_type: string, id: string) => void mocks.reminderDeletes.push(id),
}));

const { deleteTaskWithUndo, postponeTaskToTomorrow, toggleTaskCompletion } = await import("./TaskList");
const { flushToast, getToastSnapshot, runToastAction } = await import("../ui/toastStore");
const { commitPendingDeletes, isPendingDelete } = await import("../../lib/deferredDelete");
const { UNDO_DURATION_MS } = await import("../ui/undoToast");
const { tomorrowStr } = await import("../../lib/date");

function task(overrides: Partial<Task>): Task {
  return {
    title: "牛乳を買う",
    priority: "medium",
    completed: false,
    repeat: "none",
    createdAt: 1,
    ...overrides,
  } as Task;
}

function seed(...tasks: Task[]) {
  for (const t of tasks) mocks.rows.set(t.id!, t);
}

function pressUndo() {
  const toast = getToastSnapshot();
  if (!toast?.actionLabel) throw new Error("「元に戻す」が出ていない");
  runToastAction(toast.id);
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.rows.clear();
  mocks.deleted.length = 0;
  mocks.reminderDeletes.length = 0;
});

afterEach(async () => {
  flushToast();
  await commitPendingDeletes();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
});

describe("タスクの削除(deleteTaskWithUndo)", () => {
  it("確認なしで、サブタスクごと一覧から隠す。DB から消すのは5秒後", async () => {
    seed(task({ id: "p", title: "引っ越し" }), task({ id: "c1", parentTaskId: "p" }), task({ id: "c2", parentTaskId: "p" }));

    await deleteTaskWithUndo("p");
    expect(getToastSnapshot()).toMatchObject({ message: "「引っ越し」とサブタスク2件を削除しました", actionLabel: "元に戻す" });
    expect(["p", "c1", "c2"].every((id) => isPendingDelete("tasks", id))).toBe(true);
    expect(mocks.deleted).toEqual([]);

    await vi.advanceTimersByTimeAsync(UNDO_DURATION_MS);
    expect(mocks.deleted.sort()).toEqual(["c1", "c2", "p"]);
    // 場所リマインドも、これまでと同じく一緒に落とす。
    expect(mocks.reminderDeletes.sort()).toEqual(["c1", "c2", "p"]);
  });

  it("サブタスクだけを消した時は、そうと分かる文にする", async () => {
    seed(task({ id: "p", title: "引っ越し" }), task({ id: "c1", title: "段ボール", parentTaskId: "p" }));
    await deleteTaskWithUndo("c1");
    expect(getToastSnapshot()?.message).toBe("サブタスク「段ボール」を削除しました");
    expect(isPendingDelete("tasks", "c1")).toBe(true);
    expect(isPendingDelete("tasks", "p")).toBe(false);
  });

  it("元に戻すと、DB には何も書かずに一覧へ戻る", async () => {
    seed(task({ id: "t1" }));
    await deleteTaskWithUndo("t1");
    pressUndo();

    expect(isPendingDelete("tasks", "t1")).toBe(false);
    await vi.advanceTimersByTimeAsync(UNDO_DURATION_MS * 2);
    expect(mocks.deleted).toEqual([]);
    expect(mocks.rows.has("t1")).toBe(true);
  });
});

describe("タスクの完了(toggleTaskCompletion)", () => {
  it("完了すると「元に戻す」が出て、押すと完了前に戻る", async () => {
    seed(task({ id: "t1" }));
    await toggleTaskCompletion(mocks.rows.get("t1")!);
    expect(mocks.rows.get("t1")).toMatchObject({ completed: true });
    expect(getToastSnapshot()).toMatchObject({ message: "「牛乳を買う」を完了しました", actionLabel: "元に戻す" });

    pressUndo();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.rows.get("t1")!.completed).toBe(false);
    expect(mocks.rows.get("t1")!.completedAt).toBeUndefined();
  });

  it("繰り返しのタスクは、戻す時に足した次の回も取り下げる", async () => {
    seed(task({ id: "daily", repeat: "daily", dueDate: "2026-10-12" }));
    await toggleTaskCompletion(mocks.rows.get("daily")!);
    const next = [...mocks.rows.values()].find((t) => t.id !== "daily");
    expect(next).toMatchObject({ dueDate: "2026-10-13", completed: false });

    pressUndo();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.rows.has(next!.id!)).toBe(false);
    expect(mocks.rows.get("daily")!.completed).toBe(false);
  });

  it("完了を外す時(戻す操作)には出さない", async () => {
    seed(task({ id: "t1", completed: true, completedAt: 5 }));
    await toggleTaskCompletion(mocks.rows.get("t1")!);
    expect(mocks.rows.get("t1")!.completed).toBe(false);
    expect(getToastSnapshot()).toBeNull();
  });
});

describe("明日へ(postponeTaskToTomorrow)", () => {
  it("「元に戻す」で、ずらす前の期日に戻す", async () => {
    seed(task({ id: "t1", dueDate: "2026-10-10" }));
    await postponeTaskToTomorrow(mocks.rows.get("t1")!);
    expect(mocks.rows.get("t1")!.dueDate).toBe(tomorrowStr());
    expect(getToastSnapshot()).toMatchObject({ message: "期日を明日にしました", actionLabel: "元に戻す" });

    pressUndo();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.rows.get("t1")!.dueDate).toBe("2026-10-10");
  });
});
