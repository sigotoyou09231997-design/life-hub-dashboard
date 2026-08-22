import { useState } from "react";
import { db } from "../../db/schema";
import type { TripPackingItem, TripPackingCategory } from "../../types";
import { TRIP_PACKING_CATEGORIES } from "../../lib/tripCategories";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel>
        <Input
          label="持ち物"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 充電器"
          required
          autoFocus
        />
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
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "持ち物を追加"}
        </Button>
      </FormActions>
    </form>
  );
}
