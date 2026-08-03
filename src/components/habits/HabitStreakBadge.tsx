import { Flame } from "lucide-react";

export function HabitStreakBadge({ streak }: { streak: number }) {
  if (streak <= 0) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-warning">
      <Flame size={12} />
      {streak}日連続
    </span>
  );
}
