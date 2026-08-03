import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import { todayStr } from "../../lib/date";
import { Card } from "../ui/Card";
import { ChevronRight, Check } from "lucide-react";

export function HabitsCard() {
  const today = todayStr();
  const habits = useLiveQuery(() => db.habits.toArray(), []);
  const todayLogs = useLiveQuery(() => db.habitLogs.where("date").equals(today).toArray(), [today]);

  const activeHabits = (habits ?? []).filter((h) => h.active);
  const doneSet = new Set((todayLogs ?? []).filter((l) => l.done).map((l) => l.habitId));

  async function toggle(habitId: number) {
    const existing = (todayLogs ?? []).find((l) => l.habitId === habitId);
    if (existing?.id) {
      await db.habitLogs.update(existing.id, { done: !existing.done });
    } else {
      await db.habitLogs.add({ habitId, date: today, done: true });
    }
  }

  return (
    <Card>
      <Link to="/records/habits" className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-600">習慣</p>
        <ChevronRight size={18} className="text-slate-300" />
      </Link>

      {activeHabits.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">習慣がまだ登録されていません</p>
      ) : (
        <div className="mt-2 space-y-2">
          {activeHabits.map((h) => {
            const done = doneSet.has(h.id!);
            return (
              <div key={h.id} className="flex items-center gap-2.5">
                <button
                  onClick={() => toggle(h.id!)}
                  aria-label="今日の達成を切り替え"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                    done ? "border-success bg-success text-white" : "border-slate-300"
                  }`}
                >
                  {done && <Check size={12} strokeWidth={3} />}
                </button>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{h.title}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
