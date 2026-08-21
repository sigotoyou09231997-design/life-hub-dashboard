import type { Note } from "../../types";
import { db } from "../../db/schema";
import { todayStr } from "../../lib/date";
import { getNoteType, getNoteTypeDef } from "../../lib/noteTypes";
import { Badge } from "../ui/Badge";
import { ListRow } from "../ui/ListRow";
import { Pin, CheckSquare, CalendarPlus, Trash2 } from "lucide-react";

interface Props {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (id: string) => void;
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

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

function NoteSummary({ note }: { note: Note }) {
  const type = getNoteType(note);

  if (type === "checklist") {
    const items = note.checklistItems ?? [];
    const checkedCount = items.filter((i) => i.checked).length;
    return (
      <div className="note-widget__progress"><span><i style={{ width: `${items.length ? (checkedCount / items.length) * 100 : 0}%` }} /></span><small>{items.length === 0 ? "項目がありません" : `${checkedCount}/${items.length} 完了`}</small></div>
    );
  }

  if (type === "shopping") {
    const items = note.shoppingItems ?? [];
    const planned = items.reduce((sum, i) => sum + (i.price ?? 0), 0);
    const purchased = items.filter((i) => i.purchased).reduce((sum, i) => sum + (i.price ?? 0), 0);
    return (
      <div className="note-widget__shopping"><strong>{items.length}</strong><span>items</span><small>{items.length === 0 ? "商品がありません" : `${yen(purchased)} / ${yen(planned)}`}</small></div>
    );
  }

  return note.body ? <p className="mt-1 line-clamp-2 text-xs text-slate-500">{note.body}</p> : null;
}

export function NoteCard({ note, onEdit, onDelete }: Props) {
  const type = getNoteType(note);
  const typeDef = getNoteTypeDef(type);
  const TypeIcon = typeDef.icon;

  return (
    <ListRow interactive className={`note-widget note-widget--${type} h-full p-0 md:min-h-[190px]`}>
      <button
        type="button"
        onClick={() => onEdit(note)}
        aria-label={`${note.title}を編集`}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      />
      <div className="pointer-events-none relative z-10 flex h-full flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <TypeIcon size={14} className="shrink-0 text-slate-400" />
              {note.pinned && <Pin size={13} className="shrink-0 text-accent" />}
              <p className="line-clamp-2 text-sm font-medium text-slate-900" title={note.title}>
                {note.title}
              </p>
            </div>
            <NoteSummary note={note} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={typeDef.tone}>{typeDef.label}</Badge>
              {note.category && <Badge tone="accent">{note.category}</Badge>}
              {note.tags.map((tag) => (
                <Badge key={tag} tone="neutral">
                  #{tag}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="note-widget__actions pointer-events-auto mt-auto flex items-center gap-2 border-t border-white/35 pt-3">
          {type === "memo" && (
            <>
              <button
                type="button"
                onClick={() => convertToTask(note)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <CheckSquare size={14} />
                タスク化
              </button>
              <button
                type="button"
                onClick={() => convertToEvent(note)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <CalendarPlus size={14} />
                予定化
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              if (note.id && confirm(`「${note.title}」を削除しますか?`)) onDelete(note.id);
            }}
            aria-label="削除"
            className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </ListRow>
  );
}
