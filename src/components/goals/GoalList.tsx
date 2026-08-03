import type { Goal } from "../../types";
import { GoalCard } from "./GoalCard";

interface Props {
  goals: Goal[];
  onEdit: (goal: Goal) => void;
  onDelete: (id: number) => void;
}

export function GoalList({ goals, onEdit, onDelete }: Props) {
  if (goals.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">目標がまだありません</p>;
  }

  const sorted = [...goals].sort((a, b) => (a.deadline ?? "9999-99-99").localeCompare(b.deadline ?? "9999-99-99"));

  return (
    <div className="space-y-2">
      {sorted.map((g) => (
        <GoalCard key={g.id} goal={g} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}
