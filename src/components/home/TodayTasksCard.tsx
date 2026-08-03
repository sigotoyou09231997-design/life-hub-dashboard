import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import { todayStr } from "../../lib/date";
import { toggleTaskCompletion } from "../tasks/TaskList";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { ChevronRight, Check } from "lucide-react";

export function TodayTasksCard() {
  const today = todayStr();
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);

  const relevant = (tasks ?? []).filter(
    (t) => !t.completed && t.dueDate && t.dueDate <= today,
  );
  const sorted = relevant.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

  return (
    <Card>
      <Link to="/records/tasks" className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-600">今日のタスク</p>
        <ChevronRight size={18} className="text-slate-300" />
      </Link>

      {sorted.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">今日やることはありません</p>
      ) : (
        <div className="mt-2 space-y-2">
          {sorted.slice(0, 4).map((t) => {
            const overdue = t.dueDate! < today;
            return (
              <div key={t.id} className="flex items-center gap-2.5">
                <button
                  onClick={() => toggleTaskCompletion(t)}
                  aria-label="完了にする"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300"
                >
                  <Check size={12} strokeWidth={3} className="text-transparent" />
                </button>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{t.title}</span>
                {overdue && <Badge tone="danger">期限切れ</Badge>}
              </div>
            );
          })}
          {sorted.length > 4 && <p className="text-xs text-slate-400">他{sorted.length - 4}件</p>}
        </div>
      )}
    </Card>
  );
}
