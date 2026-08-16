import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "lucide-react";
import { db } from "../../db/schema";
import type { Note, NoteType } from "../../types";
import { NOTE_TYPE_DEFS, getNoteType } from "../../lib/noteTypes";
import { AREA_ACCENT_STYLE } from "../../lib/areaColors";
import { PageHeader } from "../../components/ui/PageHeader";
import { Sheet } from "../../components/ui/Sheet";
import { NoteList } from "../../components/notes/NoteList";
import { MemoForm } from "../../components/notes/MemoForm";
import { ChecklistForm } from "../../components/notes/ChecklistForm";
import { ShoppingForm } from "../../components/notes/ShoppingForm";
import { useToast } from "../../components/ui/ToastProvider";
import { ListSkeleton } from "../../components/ui/ListSkeleton";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";

type Editing = { mode: "new"; type: NoteType } | { mode: "edit"; note: Note } | null;

const FORM_TITLE: Record<NoteType, { new: string; edit: string }> = {
  memo: { new: "メモを追加", edit: "メモを編集" },
  checklist: { new: "チェックリストを追加", edit: "チェックリストを編集" },
  shopping: { new: "買い物リストを追加", edit: "買い物リストを編集" },
};

export default function NotePage() {
  const showToast = useToast();
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const notes = useLiveQuery(() => db.notes.toArray(), []);
  const showSkeleton = useDelayedFlag(notes === undefined);

  const editingType = editing ? (editing.mode === "new" ? editing.type : getNoteType(editing.note)) : null;
  const editingInitial = editing?.mode === "edit" ? editing.note : undefined;

  function closeEditing() {
    setEditing(null);
  }

  function handleSaved() {
    closeEditing();
    showToast("保存しました");
  }

  function handleDelete(id: string) {
    db.notes.delete(id);
    showToast("削除しました");
  }

  return (
    <div className="spatial-page notes-page micro-contrast pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.notes}>
      <PageHeader
        title="メモ・リスト"
        backTo="/"
        right={
          <button
            onClick={() => setAddTypeOpen(true)}
            aria-label="メモ・リストを追加"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white shadow-sm transition-colors active:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <Plus size={20} />
          </button>
        }
      />

      <div className="spatial-page-content notes-workspace px-5 lg:px-8">
        {showSkeleton ? (
          <ListSkeleton />
        ) : (
          <NoteList
            notes={notes ?? []}
            onAdd={() => setAddTypeOpen(true)}
            onEdit={(note) => setEditing({ mode: "edit", note })}
            onDelete={handleDelete}
          />
        )}
      </div>

      <Sheet open={addTypeOpen} onClose={() => setAddTypeOpen(false)} title="何を追加しますか?">
        <div className="grid grid-cols-3 gap-3">
          {NOTE_TYPE_DEFS.map((def) => {
            const Icon = def.icon;
            return (
              <button
                key={def.value}
                onClick={() => {
                  setAddTypeOpen(false);
                  setEditing({ mode: "new", type: def.value });
                }}
                className="flex flex-col items-center gap-2 rounded-2xl glass-row py-5 active:bg-white/70"
              >
                <Icon size={24} className="text-accent" />
                <span className="text-xs font-medium text-slate-700">{def.label}</span>
              </button>
            );
          })}
        </div>
      </Sheet>

      <Sheet
        open={editing !== null}
        onClose={closeEditing}
        title={editingType ? FORM_TITLE[editingType][editing?.mode === "new" ? "new" : "edit"] : undefined}
      >
        {editingType === "memo" && (
          <MemoForm initial={editingInitial} onSaved={handleSaved} onCancel={closeEditing} />
        )}
        {editingType === "checklist" && (
          <ChecklistForm initial={editingInitial} onSaved={handleSaved} onCancel={closeEditing} />
        )}
        {editingType === "shopping" && (
          <ShoppingForm initial={editingInitial} onSaved={handleSaved} onCancel={closeEditing} />
        )}
      </Sheet>
    </div>
  );
}
