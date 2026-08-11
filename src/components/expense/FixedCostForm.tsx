import { useState } from "react";
import { db } from "../../db/schema";
import type { FixedCost } from "../../types";
import { FIXED_COST_CATEGORIES } from "../../lib/categories";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";

interface Props {
  initial?: FixedCost;
  onSaved: () => void;
  onCancel: () => void;
}

export function FixedCostForm({ initial, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? FIXED_COST_CATEGORIES[0]);
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? "");
  const [dueDay, setDueDay] = useState(initial?.dueDay?.toString() ?? "1");
  const [active, setActive] = useState(initial?.active ?? true);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (!title.trim() || !numericAmount || numericAmount <= 0) return;

    setSaving(true);
    const record: FixedCost = {
      title: title.trim(),
      category,
      amount: numericAmount,
      dueDay: Math.min(31, Math.max(1, Number(dueDay) || 1)),
      active,
    };

    if (initial?.id) {
      await db.fixedCosts.update(initial.id, record);
    } else {
      await db.fixedCosts.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="項目名" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 家賃" required />
      <Select label="カテゴリ" value={category} onChange={(e) => setCategory(e.target.value)}>
        {FIXED_COST_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      <Input
        label="毎月の金額"
        type="number"
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
        min={1}
      />
      <Input
        label="支払い日(毎月)"
        type="number"
        inputMode="numeric"
        value={dueDay}
        onChange={(e) => setDueDay(e.target.value)}
        min={1}
        max={31}
      />
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
        />
        現在も発生している固定費
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
