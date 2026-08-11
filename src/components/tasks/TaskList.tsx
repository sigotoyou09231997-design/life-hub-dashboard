import { CheckSquare } from "lucide-react";
import { db } from "../../db/schema";
import type { Task } from "../../types";
import { advanceByRepeat } from "../../lib/date";
import { TaskItem } from "./TaskItem";
import { EmptyState } from "../ui/EmptyState";
import { useToast } from "../ui/ToastProvider";

interface Props {
  tasks: Task[];
  onEdit: (task: Task) => void;
  onAddSubtask: (parentId: string) => void;
  emptyMessage?: string;
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
      notifyMinutesBefore: task.notifyMinutesBefore,
      completed: false,
      parentTaskId: task.parentTaskId,
      repeat: task.repeat,
      createdAt: Date.now(),
    });
  }
}

export async function deleteTaskCascade(id: string) {
  const children = await db.tasks.where("parentTaskId").equals(id).toArray();
  await db.tasks.bulkDelete(children.map((c) => c.id!));
  await db.tasks.delete(id);
}

export function TaskList({ tasks, onEdit, onAddSubtask, emptyMessage }: Props) {
  const showToast = useToast();

  async function handleDelete(id: string) {
    await deleteTaskCascade(id);
    showToast("削除しました");
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
      <EmptyState icon={CheckSquare} title="タスクがまだありません" description="右上の「+」から追加できます。" />
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
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
