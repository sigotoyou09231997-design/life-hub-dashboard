import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Habit } from "../../types";
import { todayStr } from "../../lib/date";
import { calculateStreak } from "../../lib/habits";
import { HabitStreakBadge } from "./HabitStreakBadge";
import { ListRow } from "../ui/ListRow";
import { EmptyState } from "../ui/EmptyState";
import { Check, Flame, Trash2 } from "lucide-react";

interface Props {
  habits: Habit[];
  onEdit: (habit: Habit) => void;
  onDelete: (id: string) => void;
}

function HabitRow({ habit, onEdit, onDelete }: { habit: Habit; onEdit: (h: Habit) => void; onDelete: (id: string) => void }) {
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
    <ListRow className="flex items-center gap-3">
      <button
        onClick={toggleToday}
        aria-label="今日の達成を切り替え"
        data-checked={doneToday ? "true" : undefined}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          doneToday ? "border-success bg-success text-white" : "border-slate-300"
        }`}
      >
        {doneToday && <Check size={16} strokeWidth={3} className="animate-check-pop motion-reduce:animate-none" />}
      </button>

      <button
        type="button"
        onClick={() => onEdit(habit)}
        aria-label={`習慣「${habit.title}」を編集`}
        className="block min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <p className="line-clamp-2 text-sm font-medium text-slate-900" title={habit.title}>
          {habit.title}
        </p>
        <div className="mt-1">
          <HabitStreakBadge streak={streak} />
        </div>
      </button>

      <button
        onClick={() => {
          if (habit.id && confirm(`「${habit.title}」を削除しますか?これまでの達成記録もすべて削除されます。`)) {
            onDelete(habit.id);
          }
        }}
        aria-label="削除"
        className="shrink-0 rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
      >
        <Trash2 size={16} />
      </button>
    </ListRow>
  );
}

export function HabitList({ habits, onEdit, onDelete }: Props) {
  if (habits.length === 0) {
    return (
      <EmptyState icon={Flame} title="習慣がまだ登録されていません" description="下のボタンから登録できます。" />
    );
  }

  return (
    <div className="space-y-2">
      {habits.map((h) => (
        <HabitRow key={h.id} habit={h} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}
