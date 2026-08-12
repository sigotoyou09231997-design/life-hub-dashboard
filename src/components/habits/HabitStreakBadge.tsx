import { Flame } from "lucide-react";
import { Badge } from "../ui/Badge";

export function HabitStreakBadge({ streak }: { streak: number }) {
  if (streak <= 0) return null;

  return (
    <Badge tone="warning">
      <Flame size={12} className="mr-1" />
      {streak}日連続
    </Badge>
  );
}
