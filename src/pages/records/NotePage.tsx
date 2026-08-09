import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Note } from "../../types";
import { PageHeader } from "../../components/ui/PageHeader";
import { Sheet } from "../../components/ui/Sheet";
import { Button } from "../../components/ui/Button";
import { NoteList } from "../../components/notes/NoteList";
import { NoteForm } from "../../components/notes/NoteForm";

export default function NotePage() {
  const [editing, setEditing] = useState<Note | "new" | null>(null);
  const notes = useLiveQuery(() => db.notes.toArray(), []);

  return (
    <div className="pb-10">
      <PageHeader title="メモ" backTo="/" />

      <div className="px-5">
        <NoteList
          notes={notes ?? []}
          onEdit={(note) => setEditing(note)}
          onDelete={(id) => db.notes.delete(id)}
        />
        <Button className="mt-4 w-full" onClick={() => setEditing("new")}>
          メモを追加
        </Button>
      </div>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "メモを追加" : "メモを編集"}
      >
        {editing && (
          <NoteForm
            initial={editing === "new" ? undefined : editing}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        )}
      </Sheet>
    </div>
  );
}
