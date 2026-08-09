import type { Task } from "../../types";
import { isOverdue } from "../../lib/date";
import { getScheduleCategory } from "../../lib/scheduleCategories";
import { Badge } from "../ui/Badge";
import { Check, Plus, Trash2 } from "lucide-react";

interface Props {
  task: Task;
  allTasks: Task[];
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  onAddSubtask: (parentId: number) => void;
  indent?: boolean;
}

const PRIORITY_TONE = { high: "danger", medium: "warning", low: "neutral" } as const;
const PRIORITY_LABEL = { high: "高", medium: "中", low: "低" } as const;

export function TaskItem({ task, allTasks, onToggle, onEdit, onDelete, onAddSubtask, indent }: Props) {
  const subtasks = allTasks.filter((t) => t.parentTaskId === task.id);
  const overdue = !task.completed && isOverdue(task.dueDate, task.dueTime);
  const category = getScheduleCategory(task.category);

  function handleDeleteClick() {
    if (!task.id) return;
    const message =
      subtasks.length > 0
        ? `「${task.title}」を削除しますか?配下のサブタスク(${subtasks.length}件)もすべて削除されます。`
        : task.parentTaskId
          ? `サブタスク「${task.title}」を削除しますか?`
          : `「${task.title}」を削除しますか?`;
    if (confirm(message)) onDelete(task.id);
  }

  return (
    <div className={indent ? "ml-8" : ""}>
      <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white p-3.5">
        <button
          onClick={() => onToggle(task)}
          aria-label="完了切り替え"
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            task.completed ? "border-success bg-success text-white" : "border-slate-300"
          }`}
        >
          {task.completed && <Check size={12} strokeWidth={3} />}
        </button>

        <div className="min-w-0 flex-1" onClick={() => onEdit(task)}>
          <p
            className={`truncate text-sm font-medium ${
              task.completed ? "text-slate-400 line-through" : "text-slate-900"
            }`}
          >
            {task.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={PRIORITY_TONE[task.priority]}>優先度: {PRIORITY_LABEL[task.priority]}</Badge>
            {task.dueDate && (
              <Badge tone={overdue ? "danger" : "neutral"}>
                {overdue ? "期限切れ: " : "期限: "}
                {task.dueDate}
                {task.dueTime ? ` ${task.dueTime}` : ""}
              </Badge>
            )}
            {task.repeat !== "none" && <Badge tone="accent">繰り返し</Badge>}
            <Badge tone={category.tone}>{category.label}</Badge>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!indent && (
            <button
              onClick={() => task.id && onAddSubtask(task.id)}
              aria-label="サブタスク追加"
              className="rounded-full p-1.5 text-slate-300 active:bg-slate-100"
            >
              <Plus size={16} />
            </button>
          )}
          <button
            onClick={handleDeleteClick}
            aria-label="削除"
            className="rounded-full p-1.5 text-slate-300 active:bg-red-50 active:text-danger"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {subtasks.length > 0 && (
        <div className="mt-2 space-y-2">
          {subtasks.map((st) => (
            <TaskItem
              key={st.id}
              task={st}
              allTasks={allTasks}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddSubtask={onAddSubtask}
              indent
            />
          ))}
        </div>
      )}
    </div>
  );
}
