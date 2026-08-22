import { useState } from "react";
import { db } from "../../db/schema";
import type { Habit } from "../../types";
import { Input } from "../ui/Input";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

interface Props {
  initial?: Habit;
  onSaved: () => void;
  onCancel: () => void;
}

export function HabitForm({ initial, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    const record: Habit = {
      title: title.trim(),
      active: initial?.active ?? true,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (initial?.id) {
      await db.habits.update(initial.id, record);
    } else {
      await db.habits.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel>
        <Input
          label="続けたいこと"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 毎日30分歩く"
          hint="毎日チェックして、続いた日数を数えます。"
          required
          autoFocus
        />
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "習慣を追加"}
        </Button>
      </FormActions>
    </form>
  );
}
