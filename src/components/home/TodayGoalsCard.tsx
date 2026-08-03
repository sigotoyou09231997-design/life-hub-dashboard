import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import { Card } from "../ui/Card";
import { ProgressBar } from "../ui/ProgressBar";
import { ChevronRight } from "lucide-react";

export function TodayGoalsCard() {
  const goals = useLiveQuery(() => db.goals.toArray(), []);
  const sorted = [...(goals ?? [])].sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));

  return (
    <Link to="/records/goals">
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-600">今日の目標</p>
          <ChevronRight size={18} className="text-slate-300" />
        </div>
        {sorted.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">目標がまだありません</p>
        ) : (
          <div className="mt-3 space-y-3">
            {sorted.slice(0, 2).map((g) => (
              <div key={g.id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="truncate text-slate-700">{g.title}</span>
                  <span className="text-slate-400">{g.progress}%</span>
                </div>
                <ProgressBar value={g.progress} colorClass={g.progress >= 100 ? "bg-success" : "bg-accent"} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </Link>
  );
}
