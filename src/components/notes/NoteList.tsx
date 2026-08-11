import { useState } from "react";
import type { Note, NoteType } from "../../types";
import { NOTE_TYPE_DEFS, getNoteType } from "../../lib/noteTypes";
import { NoteCard } from "./NoteCard";
import { EmptyState } from "../ui/EmptyState";
import { Search, StickyNote } from "lucide-react";

interface Props {
  notes: Note[];
  onEdit: (note: Note) => void;
  onDelete: (id: number) => void;
}

type TypeFilter = "all" | NoteType;

export function NoteList({ notes, onEdit, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const filtered = notes.filter((n) => {
    if (typeFilter !== "all" && getNoteType(n) !== typeFilter) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      n.title.toLowerCase().includes(q) ||
      n.body.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q)) ||
      (n.checklistItems ?? []).some((i) => i.title.toLowerCase().includes(q)) ||
      (n.shoppingItems ?? []).some((i) => i.name.toLowerCase().includes(q))
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  return (
    <div>
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="メモ・リストを検索"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3.5 text-sm outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="種類フィルター">
        <button
          type="button"
          onClick={() => setTypeFilter("all")}
          aria-pressed={typeFilter === "all"}
          className={`rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
            typeFilter === "all"
              ? "border-accent bg-accent-light font-semibold text-accent"
              : "border-slate-200 font-medium text-slate-500 hover:border-slate-300"
          }`}
        >
          すべて
        </button>
        {NOTE_TYPE_DEFS.map((def) => (
          <button
            key={def.value}
            type="button"
            onClick={() => setTypeFilter(def.value)}
            aria-pressed={typeFilter === def.value}
            className={`rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
              typeFilter === def.value
                ? "border-accent bg-accent-light font-semibold text-accent"
                : "border-slate-200 font-medium text-slate-500 hover:border-slate-300"
            }`}
          >
            {def.label}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        notes.length === 0 ? (
          <EmptyState
            icon={StickyNote}
            title="メモ・リストがまだありません"
            description="右上の「+」からメモやリストを追加できます。"
          />
        ) : (
          <EmptyState title="該当する結果が見つかりませんでした" description="検索条件や絞り込みを変えてみてください。" />
        )
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
