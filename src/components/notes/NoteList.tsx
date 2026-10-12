import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Note, NoteType } from "../../types";
import { NOTE_TYPE_DEFS, getNoteType } from "../../lib/noteTypes";
import { groupByOwner } from "../../lib/attachments";
import { NoteCard } from "./NoteCard";
import { EmptyState } from "../ui/EmptyState";
import { Search } from "lucide-react";

interface Props {
  notes: Note[];
  onEdit: (note: Note) => void;
  onDelete: (id: string) => void;
}

type TypeFilter = "all" | NoteType;

export function NoteList({ notes, onEdit, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  // メモに貼った写真。1件ずつ引くと並ぶメモの数だけ問い合わせが増えるので、
  // メモぶんをまとめて読んでから配る(src/lib/attachments.ts)。
  const photos = useLiveQuery(() => db.attachments.where("ownerType").equals("note").toArray(), []);
  const photosByNote = groupByOwner(photos ?? []);

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

  // メモが1件も無いときは案内カード1枚しか出ないので、検索の帯はそのままに、
  // カードだけ画面の下まで伸ばす(.is-empty-fill、index.css)。
  const noNotesYet = notes.length === 0;

  return (
    <div className={`notes-control-center ${noNotesYet ? "is-empty-fill" : ""}`}>
      <div className="notes-toolbar mb-5 grid gap-3 border-b border-white/35 pb-4 lg:grid-cols-[minmax(260px,1fr)_auto] lg:items-center">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="メモ・リストを検索"
          className="field-shell w-full !pl-9"
        />
      </div>

      {/* 絞り込みのチップは、選んでいる物だけ黒く塗る(ページのタブと同じ。UI/UX 調査メモ 第2弾 P-4/S-3。
          前は青緑の枠で、選んでいる方が軽く見えていた)。 */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 lg:flex-wrap lg:justify-end" role="group" aria-label="種類フィルター">
        <button
          type="button"
          onClick={() => setTypeFilter("all")}
          aria-pressed={typeFilter === "all"}
          className="lh-chip"
        >
          すべて
        </button>
        {NOTE_TYPE_DEFS.map((def) => (
          <button
            key={def.value}
            type="button"
            onClick={() => setTypeFilter(def.value)}
            aria-pressed={typeFilter === def.value}
            className="lh-chip"
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
              {/* 見出し・タブと「メモ・リスト」が3回続いていたので、ここは件数の見出しだけにする。 */}
              <div><h2 id="notes-empty-title">ぜんぶ</h2></div>
              <strong>0件</strong>
            </div>
            <div className="notes-empty-control__types">
              {NOTE_TYPE_DEFS.map((def) => {
                const Icon = def.icon;
                return <div key={def.value}><Icon size={16} /><span>{def.label}</span><strong>0</strong></div>;
              })}
            </div>
            {/* 「新しいメモ」のボタンは、右下の「＋」と同じ働きで2つ並んでいたので外した
                (UI/UX 調査メモ A-3。追加の入口は各画面の「＋」1つに決めた)。 */}
            <div className="notes-empty-control__action">
              <p><strong>最初のメモを作成</strong><span>右下の「＋」から、アイデアやリストを作れます。</span></p>
            </div>
          </section>
        ) : (
          <EmptyState title="該当する結果が見つかりませんでした" description="検索条件や絞り込みを変えてみてください。" />
        )
      ) : (
        <div className="notes-widget-grid grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {sorted.map((n) => (
            <NoteCard key={n.id} note={n} photos={photosByNote.get(n.id!) ?? []} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
