import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Task } from "../../types";
import { PageHeader } from "../../components/ui/PageHeader";
import { Sheet } from "../../components/ui/Sheet";
import { Button } from "../../components/ui/Button";
import { TaskList } from "../../components/tasks/TaskList";
import { TaskForm } from "../../components/tasks/TaskForm";

type Editing = { mode: "new" } | { mode: "edit"; task: Task } | { mode: "subtask"; parentId: number } | null;

export default function TaskPage() {
  const [editing, setEditing] = useState<Editing>(null);
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);

  return (
    <div className="pb-10">
      <PageHeader title="タスク" subtitle="今日やることを整理" backTo="/schedule" />

      <div className="px-5">
        <TaskList
          tasks={tasks ?? []}
          onEdit={(task) => setEditing({ mode: "edit", task })}
          onAddSubtask={(parentId) => setEditing({ mode: "subtask", parentId })}
        />
        <Button className="mt-4 w-full" onClick={() => setEditing({ mode: "new" })}>
          タスクを追加
        </Button>
      </div>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing?.mode === "edit" ? "タスクを編集" : editing?.mode === "subtask" ? "サブタスクを追加" : "タスクを追加"
        }
      >
        {editing && (
          <TaskForm
            initial={editing.mode === "edit" ? editing.task : undefined}
            parentTaskId={editing.mode === "subtask" ? editing.parentId : undefined}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        )}
      </Sheet>
    </div>
  );
}
