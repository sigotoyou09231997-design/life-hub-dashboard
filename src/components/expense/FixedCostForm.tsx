import { useState } from "react";
import { db } from "../../db/schema";
import type { FixedCost } from "../../types";
import { FIXED_COST_CATEGORIES } from "../../lib/categories";
import { Input, AmountInput } from "../ui/Input";
import { Select } from "../ui/Select";
import { SwitchField } from "../ui/SwitchField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="何の支払い">
        <Input
          label="項目名"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 家賃"
          required
          autoFocus
        />
        <Select label="カテゴリ" value={category} onChange={(e) => setCategory(e.target.value)}>
          {FIXED_COST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </FormPanel>

      <FormPanel caption="いくら・いつ">
        <AmountInput
          label="毎月の金額"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          min={1}
          placeholder="0"
        />
        <Input
          label="支払い日"
          hint="毎月この日に引き落とされるものとして数えます。"
          type="number"
          inputMode="numeric"
          value={dueDay}
          onChange={(e) => setDueDay(e.target.value)}
          min={1}
          max={31}
        />
        <SwitchField
          label="いまも発生している"
          hint="切ると、これからの計算に入れなくなります(記録は残ります)。"
          checked={active}
          onChange={setActive}
        />
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "固定費を追加"}
        </Button>
      </FormActions>
    </form>
  );
}
