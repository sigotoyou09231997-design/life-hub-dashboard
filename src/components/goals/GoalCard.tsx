import type { Goal } from "../../types";
import { formatDisplayDate } from "../../lib/date";
import { ProgressBar } from "../ui/ProgressBar";
import { Badge } from "../ui/Badge";
import { ListRow } from "../ui/ListRow";
import { Trash2 } from "lucide-react";

interface Props {
  goal: Goal;
  onEdit: (goal: Goal) => void;
  onDelete: (id: string) => void;
}

export function GoalCard({ goal, onEdit, onDelete }: Props) {
  return (
    <ListRow interactive className="p-0">
      <button
        type="button"
        onClick={() => onEdit(goal)}
        aria-label={`${goal.title}を編集`}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      />
      <div className="pointer-events-none relative z-10 p-3.5">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-medium text-slate-900" title={goal.title}>
              {goal.title}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {goal.category && <Badge tone="accent">{goal.category}</Badge>}
              {goal.deadline && <Badge tone="neutral">期限: {formatDisplayDate(goal.deadline)}</Badge>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (goal.id && confirm(`「${goal.title}」を削除しますか?`)) onDelete(goal.id);
            }}
            aria-label="削除"
            className="pointer-events-auto shrink-0 rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
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
    </ListRow>
  );
}
