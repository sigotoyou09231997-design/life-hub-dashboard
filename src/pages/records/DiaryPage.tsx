import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { DiaryEntry } from "../../types";
import { PageHeader } from "../../components/ui/PageHeader";
import { Sheet } from "../../components/ui/Sheet";
import { Button } from "../../components/ui/Button";
import { DiaryList } from "../../components/diary/DiaryList";
import { DiaryForm } from "../../components/diary/DiaryForm";
import { useToast } from "../../components/ui/ToastProvider";

export default function DiaryPage() {
  const showToast = useToast();
  const [editing, setEditing] = useState<DiaryEntry | "new" | null>(null);
  const entries = useLiveQuery(() => db.diaryEntries.toArray(), []);

  return (
    <div className="mx-auto max-w-[1100px] pb-10 lg:pb-8">
      <PageHeader title="日記" backTo="/records" />

      <div className="px-5 lg:px-8">
        <DiaryList
          entries={entries ?? []}
          onEdit={(entry) => setEditing(entry)}
          onDelete={(id) => {
            db.diaryEntries.delete(id);
            showToast("削除しました");
          }}
        />
        <Button className="mt-4 w-full" onClick={() => setEditing("new")}>
          今日の日記を書く
        </Button>
      </div>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "日記を書く" : "日記を編集"}
      >
        {editing && (
          <DiaryForm
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
