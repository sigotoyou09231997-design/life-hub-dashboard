import { useState } from "react";
import type { Note, NoteType } from "../../types";
import { NOTE_TYPE_DEFS, getNoteType } from "../../lib/noteTypes";
import { NoteCard } from "./NoteCard";
import { EmptyState } from "../ui/EmptyState";
import { Plus, Search } from "lucide-react";

interface Props {
  notes: Note[];
  onAdd: () => void;
  onEdit: (note: Note) => void;
  onDelete: (id: string) => void;
}

type TypeFilter = "all" | NoteType;

export function NoteList({ notes, onAdd, onEdit, onDelete }: Props) {
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
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });

  return (
    <div className="notes-control-center">
      <div className="notes-toolbar mb-5 grid gap-3 border-b border-white/35 pb-4 lg:grid-cols-[minmax(260px,1fr)_auto] lg:items-center">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="メモ・リストを検索"
          className="spatial-field w-full min-h-11 rounded-[2px] border border-white/55 bg-white/30 py-2.5 pl-9 pr-3.5 text-sm outline-none focus:border-accent/60 focus:bg-white/55 focus:ring-2 focus:ring-accent/15"
        />
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 lg:flex-wrap lg:justify-end" role="group" aria-label="種類フィルター">
        <button
          type="button"
          onClick={() => setTypeFilter("all")}
          aria-pressed={typeFilter === "all"}
          className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
            typeFilter === "all"
              ? "border-accent bg-accent-light font-semibold text-accent"
              : "border-white/50 font-medium text-slate-500 hover:border-white/80"
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
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
              typeFilter === def.value
                ? "border-accent bg-accent-light font-semibold text-accent"
                : "border-white/50 font-medium text-slate-500 hover:border-white/80"
            }`}
          >
            {def.label}
          </button>
        ))}
      </div>
      </div>

      {sorted.length === 0 ? (
        notes.length === 0 ? (
          <section className="notes-empty-control" aria-labelledby="notes-empty-title">
            <div className="notes-empty-control__heading">
              <div><span>Notes control</span><h2 id="notes-empty-title">メモ・リスト</h2></div>
              <strong>0 ITEMS</strong>
            </div>
            <div className="notes-empty-control__types">
              {NOTE_TYPE_DEFS.map((def) => {
                const Icon = def.icon;
                return <div key={def.value}><Icon size={16} /><span>{def.label}</span><strong>0</strong></div>;
              })}
            </div>
            <div className="notes-empty-control__action">
              <p><strong>最初のメモを作成</strong><span>アイデアやリストを、ここから整理できます。</span></p>
              <button type="button" onClick={onAdd}><Plus size={15} />新しいメモ</button>
            </div>
          </section>
        ) : (
          <EmptyState title="該当する結果が見つかりませんでした" description="検索条件や絞り込みを変えてみてください。" />
        )
      ) : (
        <div className="notes-widget-grid grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {sorted.map((n) => (
            <NoteCard key={n.id} note={n} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
