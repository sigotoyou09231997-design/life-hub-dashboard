import { CheckSquare } from "lucide-react";
import { db } from "../../db/schema";
import type { Task } from "../../types";
import { advanceByRepeat, tomorrowStr } from "../../lib/date";
import { TaskItem } from "./TaskItem";
import { EmptyState } from "../ui/EmptyState";
import { deleteRowWithUndo, quoted, showUndoToast } from "../ui/undoToast";

// タスクを本当に消す(サブタスクと場所リマインドも一緒に)。待っている間にアプリが閉じられた削除を
// 次に開いた時に消し切れるよう、本体は src/lib/undoableDeletes.ts に移した。ここからも今までどおり使える。
export { deleteTaskCascade } from "../../lib/undoableDeletes";

interface Props {
  tasks: Task[];
  onEdit: (task: Task) => void;
  onAddSubtask: (parentId: string) => void;
  emptyMessage?: string;
  /** 1件も無い時の「タスクを追加」。渡さなければボタンは出さない。 */
  onAdd?: () => void;
}

export async function toggleTaskCompletion(task: Task) {
  if (!task.id) return;
  const taskId = task.id;
  const completed = !task.completed;
  await db.tasks.update(taskId, {
    completed,
    completedAt: completed ? Date.now() : undefined,
  });

  let nextOccurrenceId: string | undefined;
  if (completed && task.repeat !== "none" && task.dueDate) {
    nextOccurrenceId = await db.tasks.add({
      title: task.title,
      priority: task.priority,
      dueDate: advanceByRepeat(task.dueDate, task.repeat),
      dueTime: task.dueTime,
      // カテゴリも引き継ぐ。ここが抜けていると、繰り返すたびに「その他」へ
      // 戻ってしまい、分類で絞り込んでいる画面から次の回が消える。
      category: task.category,
      notifyMinutesBefore: task.notifyMinutesBefore,
      completed: false,
      parentTaskId: task.parentTaskId,
      repeat: task.repeat,
      createdAt: Date.now(),
    });
  }

  // 完了には5秒間「元に戻す」を出す(UI/UX 調査メモ 第4弾 A-2)。ホーム・今日・カレンダー・一覧が
  // みなこの関数を呼ぶので、ここで出せばどこで押しても同じように戻せる。完了を外す方(戻す操作)には出さない。
  // 戻す時は、押す前の完了の印に戻し、繰り返しで足した次の回を取り下げる(足したのはこの操作なので)。
  if (completed) {
    showUndoToast(`${quoted(task.title)}を完了しました`, async () => {
      await db.tasks.update(taskId, { completed: task.completed, completedAt: task.completedAt });
      if (nextOccurrenceId) await db.tasks.delete(nextOccurrenceId);
    });
  }
}

/** 期日を明日へずらす。編集画面を開かずに済ませるための操作なので、
 * 期日以外(時刻・優先度・繰り返し)は触らない。
 * 「元に戻す」で、ずらす前の期日に戻せる(UI/UX 調査メモ 第4弾 A-2)。 */
export async function postponeTaskToTomorrow(task: Task) {
  if (!task.id) return;
  const taskId = task.id;
  const previousDueDate = task.dueDate;
  await db.tasks.update(taskId, { dueDate: tomorrowStr() });
  showUndoToast("期日を明日にしました", () => db.tasks.update(taskId, { dueDate: previousDueDate }));
}

/**
 * ゴミ箱を押した時の削除。確認は聞かずに一覧から消し、「削除しました・元に戻す」を出す
 * (UI/UX 調査メモ 第4弾 A-2。タスクは消しても5秒以内なら丸ごと戻せる小さなもの)。
 * 押した時は隠すだけで、本当に消す(deleteTaskCascade)のはお知らせが閉じた時
 * (src/lib/deferredDelete.ts。すぐ消して入れ直すと、同期の跳ね返りで戻した行がまた消えるため)。
 * サブタスクも一緒に隠す。
 */
export async function deleteTaskWithUndo(id: string) {
  const [task, childIds] = await Promise.all([
    db.tasks.get(id),
    db.tasks.where("parentTaskId").equals(id).primaryKeys(),
  ]);
  const name = `${task?.parentTaskId ? "サブタスク" : ""}${quoted(task?.title) || "タスク"}`;
  const message = childIds.length > 0 ? `${name}とサブタスク${childIds.length}件を削除しました` : `${name}を削除しました`;
  deleteRowWithUndo(
    "task",
    id,
    message,
    childIds.map((childId) => ({ table: "tasks", id: String(childId) })),
  );
}

export function TaskList({ tasks, onEdit, onAddSubtask, emptyMessage, onAdd }: Props) {
  // お知らせ(「元に戻す」付き)は削除・先送りの関数の中で出す。ここで重ねて出すと、
  // 「元に戻す」付きのお知らせが文だけのお知らせに置き換わって押せなくなる。
  async function handleDelete(id: string) {
    await deleteTaskWithUndo(id);
  }

  async function handlePostpone(task: Task) {
    await postponeTaskToTomorrow(task);
  }

  const topLevel = tasks.filter((t) => !t.parentTaskId);
  const incomplete = topLevel
    .filter((t) => !t.completed)
    .sort((a, b) => (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99"));
  const completed = topLevel.filter((t) => t.completed);

  if (topLevel.length === 0) {
    return emptyMessage ? (
      <EmptyState title={emptyMessage} />
    ) : (
      // 「＋」の場所は書かない — スマホは右下・PCは上の帯で、どちらかと必ず食い違う(UI/UX 調査メモ 第3弾 N-1)。
      // 線画と、始めたくなる一言(第4弾 B-6)。
      <EmptyState
        icon={CheckSquare}
        illustration="tasks"
        title="すっきり、やることはありません"
        description="何か1つ足しますか？ 期日を入れると、近い順に並びます。"
        action={onAdd ? { label: "タスクを追加", onClick: onAdd } : undefined}
      />
    );
  }

  return (
    <div className="space-y-2">
      {incomplete.map((t) => (
        <TaskItem
          key={t.id}
          task={t}
          allTasks={tasks}
          onToggle={toggleTaskCompletion}
          onEdit={onEdit}
          onDelete={handleDelete}
          onAddSubtask={onAddSubtask}
          onPostpone={handlePostpone}
          collapseOnComplete
        />
      ))}

      {completed.length > 0 && (
        <div className="pt-4">
          <p className="mb-2 text-xs font-medium text-slate-400">完了済み</p>
          <div className="space-y-2">
            {completed.map((t) => (
              <TaskItem
                key={t.id}
                task={t}
                allTasks={tasks}
                onToggle={toggleTaskCompletion}
                onEdit={onEdit}
                onDelete={handleDelete}
                onAddSubtask={onAddSubtask}
                onPostpone={handlePostpone}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
