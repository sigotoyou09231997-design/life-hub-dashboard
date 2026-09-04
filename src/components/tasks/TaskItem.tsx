import type { Task } from "../../types";
import { formatCompactDate, isDueTodayOrEarlier, isOverdue } from "../../lib/date";
import { getScheduleCategory } from "../../lib/scheduleCategories";
import { isRepeating, repeatLabel } from "../../lib/repeatRule";
import { Badge } from "../ui/Badge";
import { ListRow } from "../ui/ListRow";
import { CalendarArrowDown, Check, Plus, Trash2 } from "lucide-react";

interface Props {
  task: Task;
  allTasks: Task[];
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onAddSubtask: (parentId: string) => void;
  /** 期日を明日へずらす。渡さなければ「明日へ」は出ない。 */
  onPostpone?: (task: Task) => void;
  indent?: boolean;
}

const PRIORITY_TONE = { high: "danger", medium: "warning", low: "neutral" } as const;
const PRIORITY_LABEL = { high: "高", medium: "中", low: "低" } as const;

export function TaskItem({ task, allTasks, onToggle, onEdit, onDelete, onAddSubtask, onPostpone, indent }: Props) {
  const subtasks = allTasks.filter((t) => t.parentTaskId === task.id);
  const overdue = !task.completed && isOverdue(task.dueDate, task.dueTime);
  const category = getScheduleCategory(task.category);
  // 「明日へ」は、まだ終わっていない今日ぶん・期限切れのタスクにだけ出す。
  // 先の日付のタスクに出しても押す理由が無く、行のボタンが増えるだけになる。
  const canPostpone = Boolean(onPostpone) && !task.completed && isDueTodayOrEarlier(task.dueDate);

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
      <ListRow className={`task-completion flex items-start gap-3 transition-opacity duration-200 ${task.completed ? "task-completion--done opacity-60" : "opacity-100"}`}>
        <button
          onClick={() => onToggle(task)}
          aria-label="完了切り替え"
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            task.completed ? "border-success bg-success text-white" : "border-slate-300"
          }`}
        >
          {task.completed && <Check size={12} strokeWidth={3} className="animate-check-pop motion-reduce:animate-none" />}
        </button>

        <button
          type="button"
          onClick={() => onEdit(task)}
          aria-label={`タスク「${task.title}」を編集`}
          className="block min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <p
            title={task.title}
            className={`line-clamp-2 text-sm font-medium ${
              task.completed ? "text-slate-400 line-through" : "text-slate-900"
            }`}
          >
            {task.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={PRIORITY_TONE[task.priority]}>優先度 {PRIORITY_LABEL[task.priority]}</Badge>
            {task.dueDate && (
              // 期限は "2026-08-21 10:00" のようなISO表記だと、これだけでバッジ列が
              // 折り返して1件あたり1行増えていた。今日/明日など読んで分かる短い形にする。
              <Badge tone={overdue ? "danger" : "neutral"}>
                {overdue ? "期限切れ " : "期限 "}
                {formatCompactDate(task.dueDate)}
                {task.dueTime ? ` ${task.dueTime}` : ""}
              </Badge>
            )}
            {isRepeating(task.repeat) && <Badge tone="accent">{repeatLabel(task.repeat)}</Badge>}
            <Badge tone={category.tone}>{category.label}</Badge>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {canPostpone && (
            <button
              onClick={() => onPostpone!(task)}
              aria-label={`「${task.title}」の期日を明日にする`}
              className="flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <CalendarArrowDown size={14} />
              明日へ
            </button>
          )}
          {!indent && (
            <button
              onClick={() => task.id && onAddSubtask(task.id)}
              aria-label="サブタスク追加"
              className="rounded-full p-1.5 text-slate-300 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <Plus size={16} />
            </button>
          )}
          <button
            onClick={handleDeleteClick}
            aria-label="削除"
            className="rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </ListRow>

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
