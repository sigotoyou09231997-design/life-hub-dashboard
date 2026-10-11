import { useState } from "react";
import { db } from "../../db/schema";
import type { TripPackingItem, TripPackingCategory } from "../../types";
import { TRIP_PACKING_CATEGORIES } from "../../lib/tripCategories";
import { Input } from "../ui/Input";
import { SegmentedField } from "../ui/SegmentedField";
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
      // 種類を変えたら、移った先の種類の最後に回す(前の種類での番号を持ち込まない)。
      ...(initial && initial.category !== category ? { sortOrder: undefined } : {}),
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
        {/* プルダウンにしない(2026-10-11)。iPhone では、持ち物の欄でキーボードを出したまま
            プルダウンを押すと、選択肢がキーボードで持ち上がったシートの位置に出て、キーボードが
            閉じてシートが下りた後も上に取り残された。5つなら全部並べて1回で選べる。
            2段になるので、1つの溝に入れずボタンを分ける(separate)。 */}
        <SegmentedField
          label="カテゴリ"
          value={category}
          options={TRIP_PACKING_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
          onChange={setCategory}
          columns={3}
          separate
        />
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
