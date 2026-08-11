import { useState } from "react";
import { db } from "../../db/schema";
import type { TripPackingItem, TripPackingCategory } from "../../types";
import { TRIP_PACKING_CATEGORIES } from "../../lib/tripCategories";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";

interface Props {
  tripId: string;
  initial?: TripPackingItem;
  onSaved: () => void;
  onCancel: () => void;
}

export function TripPackingForm({ tripId, initial, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState<TripPackingCategory>(initial?.category ?? "essentials");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    const record: TripPackingItem = {
      tripId,
      title: title.trim(),
      category,
      checked: initial?.checked ?? false,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (initial?.id) {
      await db.tripPackingItems.update(initial.id, record);
    } else {
      await db.tripPackingItems.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="持ち物" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      <Select
        label="カテゴリ"
        value={category}
        onChange={(e) => setCategory(e.target.value as TripPackingCategory)}
      >
        {TRIP_PACKING_CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>

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
