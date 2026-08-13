import { useState } from "react";
import { db } from "../../db/schema";
import type { TripExpense, TripExpenseCategory } from "../../types";
import { TRIP_EXPENSE_CATEGORIES } from "../../lib/tripCategories";
import { Input, Textarea } from "../ui/Input";
import { Select } from "../ui/Select";
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="項目名" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      <Input
        label="金額"
        type="number"
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
        min={1}
      />
      <Select label="種類" value={category} onChange={(e) => setCategory(e.target.value as TripExpenseCategory)}>
        {TRIP_EXPENSE_CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
      <Input label="支払日(任意)" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={paid}
          onChange={(e) => setPaid(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
        />
        支払い済み
      </label>
      <Textarea label="メモ" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="任意" />

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
