import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Habit } from "../../types";
import { todayStr } from "../../lib/date";
import { calculateStreak } from "../../lib/habits";
import { HabitStreakBadge } from "./HabitStreakBadge";
import { Check, Trash2 } from "lucide-react";

interface Props {
  habits: Habit[];
  onEdit: (habit: Habit) => void;
  onDelete: (id: number) => void;
}

function HabitRow({ habit, onEdit, onDelete }: { habit: Habit; onEdit: (h: Habit) => void; onDelete: (id: number) => void }) {
  const today = todayStr();
  const logs = useLiveQuery(() => db.habitLogs.where("habitId").equals(habit.id!).toArray(), [habit.id]);
  const doneToday = (logs ?? []).some((l) => l.date === today && l.done);
  const streak = calculateStreak(logs ?? [], today);

  async function toggleToday() {
    const existing = (logs ?? []).find((l) => l.date === today);
    if (existing?.id) {
      await db.habitLogs.update(existing.id, { done: !existing.done });
    } else {
      await db.habitLogs.add({ habitId: habit.id!, date: today, done: true });
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3.5">
      <button
        onClick={toggleToday}
        aria-label="今日の達成を切り替え"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          doneToday ? "border-success bg-success text-white" : "border-slate-300"
        }`}
      >
        {doneToday && <Check size={16} strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1" onClick={() => onEdit(habit)}>
        <p className="truncate text-sm font-medium text-slate-900">{habit.title}</p>
        <div className="mt-1">
          <HabitStreakBadge streak={streak} />
        </div>
      </div>

      <button
        onClick={() => habit.id && onDelete(habit.id)}
        className="shrink-0 rounded-full p-1.5 text-slate-300 active:bg-red-50 active:text-danger"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

export function HabitList({ habits, onEdit, onDelete }: Props) {
  if (habits.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">習慣がまだ登録されていません</p>;
  }

  return (
    <div className="space-y-2">
      {habits.map((h) => (
        <HabitRow key={h.id} habit={h} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}
