import { useState } from "react";
import { db } from "../../db/schema";
import type { Note } from "../../types";
import { Input, Textarea } from "../ui/Input";
import { SwitchField } from "../ui/SwitchField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel>
        <Input
          label="タイトル"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 引っ越しの持ち物"
          required
          autoFocus
        />
        <Textarea label="本文" optional value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
      </FormPanel>

      <FormPanel caption="整理のしかた">
        <CategorySelect value={category} onChange={setCategory} />
        <Input
          label="タグ"
          optional
          hint="カンマで区切ると複数付けられます。"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="例: 買い物, 仕事"
        />
        <SwitchField label="ピン留めする" hint="一覧のいちばん上に出します。" checked={pinned} onChange={setPinned} />
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "メモを追加"}
        </Button>
      </FormActions>
    </form>
  );
}
