import { useState } from "react";
import { db } from "../../db/schema";
import type { Habit } from "../../types";
import { Input } from "../ui/Input";
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="習慣"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="例: 毎日30分運動する"
        required
        autoFocus
      />
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
