import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { NotebookPen, Plus } from "lucide-react";
import { db } from "../db/schema";
import type { DiaryEntry } from "../types";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { EmptyState } from "../components/ui/EmptyState";
import { DiaryForm } from "../components/diary/DiaryForm";
import { DiaryList } from "../components/diary/DiaryList";
import { useToast } from "../components/ui/ToastProvider";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { AREA_ACCENT_STYLE } from "../lib/areaColors";

export default function DiaryPage() {
  const showToast = useToast();
  const [editing, setEditing] = useState<DiaryEntry | "new" | null>(null);

  // 新しい日付を上に。同じ日に何度書いてもよいので、同日は書いた順の逆で並べる。
  const result = useLiveQuery(
    () =>
      db.diaryEntries
        .toArray()
        .then((rows) => rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)),
    [],
  );
  const entries = result ?? [];
  const trips = useLiveQuery(() => db.trips.toArray(), []) ?? [];
  const tripNameById = new Map(trips.filter((t) => t.id).map((t) => [t.id as string, t.name]));
  const tripOptions = [...trips]
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map((t) => ({ id: t.id as string, name: t.name }));
  const showSkeleton = useDelayedFlag(result === undefined);

  return (
    <div className="spatial-page diary-page micro-contrast mx-auto max-w-[1480px] pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.notes}>
      <PageHeader
        title="日記"
        backTo="/"
        right={
          <button
            onClick={() => setEditing("new")}
            aria-label="日記を書く"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white shadow-sm transition-colors active:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <Plus size={20} />
          </button>
        }
      />

      <div className="px-5 lg:px-8">
        {showSkeleton ? (
          <ListSkeleton />
        ) : entries.length === 0 ? (
          <EmptyState
            card
            icon={NotebookPen}
            title="日記がまだありません"
            description="書き始めると、そのときいた場所も一緒に残せます。"
            action={{ label: "日記を書く", onClick: () => setEditing("new") }}
          />
        ) : (
          <DiaryList
            entries={entries}
            tripNameById={tripNameById}
            onEdit={(entry) => setEditing(entry)}
            onDelete={(id) => {
              db.diaryEntries.delete(id);
              showToast("削除しました");
            }}
          />
        )}
      </div>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "日記を書く" : "日記を編集"}
      >
        {editing && (
          <DiaryForm
            initial={editing === "new" ? undefined : editing}
            tripOptions={tripOptions}
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
