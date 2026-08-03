import type { Goal } from "../../types";
import { formatDisplayDate } from "../../lib/date";
import { ProgressBar } from "../ui/ProgressBar";
import { Badge } from "../ui/Badge";
import { Trash2 } from "lucide-react";

interface Props {
  goal: Goal;
  onEdit: (goal: Goal) => void;
  onDelete: (id: number) => void;
}

export function GoalCard({ goal, onEdit, onDelete }: Props) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3.5" onClick={() => onEdit(goal)}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{goal.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {goal.category && <Badge tone="accent">{goal.category}</Badge>}
            {goal.deadline && <Badge tone="neutral">期限: {formatDisplayDate(goal.deadline)}</Badge>}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (goal.id) onDelete(goal.id);
          }}
          className="shrink-0 rounded-full p-1.5 text-slate-300 active:bg-red-50 active:text-danger"
        >
          <Trash2 size={16} />
        </button>
      </div>
      <div className="mt-3">
        <ProgressBar value={goal.progress} colorClass={goal.progress >= 100 ? "bg-success" : "bg-accent"} />
        <div className="mt-1.5 flex justify-between text-xs text-slate-400">
          <span>{goal.progress}% 達成</span>
          {goal.targetAmount != null && (
            <span>
              ¥{(goal.currentAmount ?? 0).toLocaleString()} / ¥{goal.targetAmount.toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
