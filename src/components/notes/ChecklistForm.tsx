import { useState } from "react";
import { db } from "../../db/schema";
import type { Note, ChecklistItem } from "../../types";
import { moveItem } from "../../lib/noteTypes";
import { NOTE_CATEGORIES } from "../../lib/categories";
import { Input, Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { ListRow } from "../ui/ListRow";
import { CategorySelect } from "./CategorySelect";
import { Check, ChevronDown, ChevronUp, Trash2 } from "lucide-react";

interface Props {
  initial?: Note;
  onSaved: () => void;
  onCancel: () => void;
}

export function ChecklistForm({ initial, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [tagsInput, setTagsInput] = useState(initial?.tags.join(", ") ?? "");
  const [category, setCategory] = useState(initial?.category ?? NOTE_CATEGORIES[0]);
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [items, setItems] = useState<ChecklistItem[]>(initial?.checklistItems ?? []);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [saving, setSaving] = useState(false);

  // Item add/edit/delete/reorder stay in local state only, exactly like the
  // title/category/pinned fields below — nothing is written to the DB until
  // "保存する" is submitted, so closing with "キャンセル" reverts everything.
  function addItem() {
    if (!newItemTitle.trim()) return;
    setItems([...items, { id: crypto.randomUUID(), title: newItemTitle.trim(), checked: false }]);
    setNewItemTitle("");
  }

  function toggleItem(id: string) {
    setItems(items.map((it) => (it.id === id ? { ...it, checked: !it.checked } : it)));
  }

  function renameItem(id: string, newTitle: string) {
    setItems(items.map((it) => (it.id === id ? { ...it, title: newTitle } : it)));
  }

  function deleteItem(id: string) {
    setItems(items.filter((it) => it.id !== id));
  }

  function reorderItem(index: number, direction: -1 | 1) {
    setItems(moveItem(items, index, direction));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    const now = Date.now();
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const record: Note = {
      type: "checklist",
      title: title.trim(),
      body,
      tags,
      category,
      pinned,
      checklistItems: items,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    };

    if (initial?.id) {
      await db.notes.put({ ...record, id: initial.id });
    } else {
      await db.notes.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="タイトル" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      <CategorySelect value={category} onChange={setCategory} />
      <Input
        label="タグ(カンマ区切り)"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        placeholder="例: 買い物, 仕事"
      />
      <Textarea label="メモ(任意)" value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={pinned}
          onChange={(e) => setPinned(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
        />
        ピン留めする
      </label>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-600">項目</p>
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">項目がありません</p>
        ) : (
          <div className="space-y-2">
            {items.map((item, index) => (
              <ListRow key={item.id} className="flex items-center gap-2 p-2.5">
                <button
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  aria-label="完了を切り替え"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                    item.checked ? "border-success bg-success text-white" : "border-slate-300"
                  }`}
                >
                  {item.checked && <Check size={14} strokeWidth={3} />}
                </button>
                <input
                  value={item.title}
                  onChange={(e) => renameItem(item.id, e.target.value)}
                  className={`min-w-0 flex-1 border-none bg-transparent text-sm outline-none ${
                    item.checked ? "text-slate-400 line-through" : "text-slate-900"
                  }`}
                />
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => reorderItem(index, -1)}
                    disabled={index === 0}
                    aria-label="上へ"
                    className="rounded-full p-1 text-slate-300 transition-colors disabled:opacity-30 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => reorderItem(index, 1)}
                    disabled={index === items.length - 1}
                    aria-label="下へ"
                    className="rounded-full p-1 text-slate-300 transition-colors disabled:opacity-30 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    <ChevronDown size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteItem(item.id)}
                    aria-label="項目を削除"
                    className="rounded-full p-1 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </ListRow>
            ))}
          </div>
        )}

        <div className="mt-2 flex gap-2">
          <input
            value={newItemTitle}
            onChange={(e) => setNewItemTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addItem();
              }
            }}
            placeholder="項目を追加"
            className="min-w-0 flex-1 rounded-xl border border-white/50 bg-white/40 px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
          />
          <Button type="button" variant="secondary" onClick={addItem}>
            追加
          </Button>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-5 flex gap-3 border-t border-white/50 bg-white/80 px-5 py-3 backdrop-blur-md">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" className="flex-1" disabled={saving}>
          保存する
        </Button>
      </div>
    </form>
  );
}
