import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Habit } from "../../types";
import { PageHeader } from "../../components/ui/PageHeader";
import { Sheet } from "../../components/ui/Sheet";
import { Button } from "../../components/ui/Button";
import { HabitList } from "../../components/habits/HabitList";
import { HabitForm } from "../../components/habits/HabitForm";
import { useToast } from "../../components/ui/ToastProvider";

export default function HabitPage() {
  const showToast = useToast();
  const [editing, setEditing] = useState<Habit | "new" | null>(null);
  const habits = useLiveQuery(() => db.habits.toArray(), []);

  return (
    <div className="mx-auto max-w-[1100px] pb-10 lg:pb-8">
      <PageHeader title="習慣" subtitle="毎日のチェックで続ける" backTo="/records" />

      <div className="px-5 lg:px-8">
        <HabitList
          habits={habits ?? []}
          onEdit={(h) => setEditing(h)}
          onDelete={async (id) => {
            await db.habitLogs.where("habitId").equals(id).delete();
            await db.habits.delete(id);
            showToast("削除しました");
          }}
        />
        <Button className="mt-4 w-full" onClick={() => setEditing("new")}>
          習慣を追加
        </Button>
      </div>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "習慣を追加" : "習慣を編集"}
      >
        {editing && (
          <HabitForm
            initial={editing === "new" ? undefined : editing}
            onSaved={() => {
              setEditing(null);
              showToast("保存しました");
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Sheet>
    </div>
  );
}
