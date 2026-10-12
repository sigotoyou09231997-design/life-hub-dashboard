import { CheckSquare } from "lucide-react";
import { db } from "../../db/schema";
import type { Task } from "../../types";
import { advanceByRepeat, tomorrowStr } from "../../lib/date";
import { deletePlaceRemindersFor } from "../../lib/placeReminders";
import { TaskItem } from "./TaskItem";
import { EmptyState } from "../ui/EmptyState";
import { useToast } from "../ui/ToastProvider";

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
  const completed = !task.completed;
  await db.tasks.update(task.id, {
    completed,
    completedAt: completed ? Date.now() : undefined,
  });

  if (completed && task.repeat !== "none" && task.dueDate) {
    await db.tasks.add({
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
}

/** 期日を明日へずらす。編集画面を開かずに済ませるための操作なので、
 * 期日以外(時刻・優先度・繰り返し)は触らない。 */
export async function postponeTaskToTomorrow(task: Task) {
  if (!task.id) return;
  await db.tasks.update(task.id, { dueDate: tomorrowStr() });
}

export async function deleteTaskCascade(id: string) {
  const children = await db.tasks.where("parentTaskId").equals(id).toArray();
  await db.tasks.bulkDelete(children.map((c) => c.id!));
  await db.tasks.delete(id);
  // 場所リマインドは別のテーブルにあるので、一緒に落とす
  // (src/lib/placeReminders.ts)。残すと、消したタスクのために鳴り続ける。
  await Promise.all([...children.map((c) => deletePlaceRemindersFor("task", c.id!)), deletePlaceRemindersFor("task", id)]);
}

export function TaskList({ tasks, onEdit, onAddSubtask, emptyMessage, onAdd }: Props) {
  const showToast = useToast();

  async function handleDelete(id: string) {
    await deleteTaskCascade(id);
    showToast("削除しました");
  }

  async function handlePostpone(task: Task) {
    await postponeTaskToTomorrow(task);
    showToast("期日を明日にしました");
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
