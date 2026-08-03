import { useState } from "react";
import type { Note } from "../../types";
import { NoteCard } from "./NoteCard";
import { Search } from "lucide-react";

interface Props {
  notes: Note[];
  onEdit: (note: Note) => void;
  onDelete: (id: number) => void;
}

export function NoteList({ notes, onEdit, onDelete }: Props) {
  const [query, setQuery] = useState("");

  const filtered = notes.filter((n) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      n.title.toLowerCase().includes(q) ||
      n.body.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  return (
    <div>
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="メモを検索"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3.5 text-sm outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">メモがありません</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((n) => (
            <NoteCard key={n.id} note={n} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
