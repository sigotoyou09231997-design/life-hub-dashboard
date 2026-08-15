import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Goal } from "../../types";
import { PageHeader } from "../../components/ui/PageHeader";
import { Sheet } from "../../components/ui/Sheet";
import { Button } from "../../components/ui/Button";
import { GoalList } from "../../components/goals/GoalList";
import { GoalForm } from "../../components/goals/GoalForm";
import { useToast } from "../../components/ui/ToastProvider";

export default function GoalPage() {
  const showToast = useToast();
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const goals = useLiveQuery(() => db.goals.toArray(), []);

  return (
    <div className="mx-auto max-w-[1100px] pb-10 lg:pb-8">
      <PageHeader title="目標" backTo="/records" />

      <div className="px-5 lg:px-8">
        <GoalList
          goals={goals ?? []}
          onEdit={(g) => setEditing(g)}
          onDelete={(id) => {
            db.goals.delete(id);
            showToast("削除しました");
          }}
        />
        <Button className="mt-4 w-full" onClick={() => setEditing("new")}>
          目標を追加
        </Button>
      </div>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "目標を追加" : "目標を編集"}
      >
        {editing && (
          <GoalForm
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
