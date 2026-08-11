import { Target } from "lucide-react";
import type { Goal } from "../../types";
import { GoalCard } from "./GoalCard";
import { EmptyState } from "../ui/EmptyState";

interface Props {
  goals: Goal[];
  onEdit: (goal: Goal) => void;
  onDelete: (id: number) => void;
}

export function GoalList({ goals, onEdit, onDelete }: Props) {
  if (goals.length === 0) {
    return (
      <EmptyState icon={Target} title="目標がまだありません" description="下のボタンから最初の目標を追加できます。" />
    );
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
