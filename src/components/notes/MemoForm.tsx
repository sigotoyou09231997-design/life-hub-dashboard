import { useState } from "react";
import { db } from "../../db/schema";
import type { Note } from "../../types";
import { Input, Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { CategorySelect } from "./CategorySelect";
import { NOTE_CATEGORIES } from "../../lib/categories";

interface Props {
  initial?: Note;
  onSaved: () => void;
  onCancel: () => void;
}

export function MemoForm({ initial, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [tagsInput, setTagsInput] = useState(initial?.tags.join(", ") ?? "");
  const [category, setCategory] = useState(initial?.category ?? NOTE_CATEGORIES[0]);
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [saving, setSaving] = useState(false);

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
      type: "memo",
      title: title.trim(),
      body,
      tags,
      category,
      pinned,
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
      <Textarea label="本文" value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
      <CategorySelect value={category} onChange={setCategory} />
      <Input
        label="タグ(カンマ区切り)"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        placeholder="例: 買い物, 仕事"
      />
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={pinned}
          onChange={(e) => setPinned(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
        />
        ピン留めする
      </label>

      <div className="sticky bottom-0 -mx-5 flex gap-3 border-t border-slate-100 bg-white px-5 py-3">
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
