import type { Note } from "../../types";
import { db } from "../../db/schema";
import { todayStr } from "../../lib/date";
import { Badge } from "../ui/Badge";
import { Pin, CheckSquare, CalendarPlus, Trash2 } from "lucide-react";

interface Props {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (id: number) => void;
}

async function convertToTask(note: Note) {
  await db.tasks.add({
    title: note.title,
    priority: "medium",
    completed: false,
    repeat: "none",
    createdAt: Date.now(),
  });
}

async function convertToEvent(note: Note) {
  await db.calendarEvents.add({
    title: note.title,
    date: todayStr(),
    memo: note.body || undefined,
    createdAt: Date.now(),
  });
}

export function NoteCard({ note, onEdit, onDelete }: Props) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3.5">
      <div className="flex items-start justify-between gap-2" onClick={() => onEdit(note)}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {note.pinned && <Pin size={13} className="shrink-0 text-accent" />}
            <p className="truncate text-sm font-medium text-slate-900">{note.title}</p>
          </div>
          {note.body && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{note.body}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {note.category && <Badge tone="accent">{note.category}</Badge>}
            {note.tags.map((tag) => (
              <Badge key={tag} tone="neutral">
                #{tag}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-slate-50 pt-2.5">
        <button
          onClick={() => convertToTask(note)}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 active:bg-slate-100"
        >
          <CheckSquare size={14} />
          タスク化
        </button>
        <button
          onClick={() => convertToEvent(note)}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 active:bg-slate-100"
        >
          <CalendarPlus size={14} />
          予定化
        </button>
        <button
          onClick={() => note.id && onDelete(note.id)}
          className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 active:bg-red-50 active:text-danger"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
