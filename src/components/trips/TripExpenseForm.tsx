import { useState } from "react";
import { db } from "../../db/schema";
import type { TripExpense, TripExpenseCategory } from "../../types";
import { TRIP_EXPENSE_CATEGORIES } from "../../lib/tripCategories";
import { Input, Textarea, AmountInput } from "../ui/Input";
import { Select } from "../ui/Select";
import { SwitchField } from "../ui/SwitchField";
import { DateField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

interface Props {
  tripId: string;
  initial?: TripExpense;
  onSaved: () => void;
  onCancel: () => void;
}

export function TripExpenseForm({ tripId, initial, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? "");
  const [category, setCategory] = useState<TripExpenseCategory>(initial?.category ?? "other");
  const [paidDate, setPaidDate] = useState(initial?.paidDate ?? "");
  const [paid, setPaid] = useState(initial?.paid ?? false);
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (!title.trim() || !numericAmount || numericAmount <= 0) return;

    setSaving(true);
    const record: TripExpense = {
      tripId,
      title: title.trim(),
      amount: numericAmount,
      category,
      paidDate: paidDate || undefined,
      paid,
      memo: memo || undefined,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (initial?.id) {
      await db.tripExpenses.update(initial.id, record);
    } else {
      await db.tripExpenses.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="何にいくら">
        <Input
          label="項目名"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 航空券"
          required
          autoFocus
        />
        <AmountInput
          label="金額"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          min={1}
          placeholder="0"
        />
        <Select label="種類" value={category} onChange={(e) => setCategory(e.target.value as TripExpenseCategory)}>
          {TRIP_EXPENSE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </FormPanel>

      <FormPanel caption="支払い">
        <SwitchField label="支払い済み" checked={paid} onChange={setPaid} />
        <DateField label="支払日" optional value={paidDate} onChange={setPaidDate} placeholder="まだ決めていない" />
        <Textarea label="メモ" optional value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "費用を追加"}
        </Button>
      </FormActions>
    </form>
  );
}
