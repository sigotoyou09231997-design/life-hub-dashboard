import { useState } from "react";
import { db } from "../../db/schema";
import type { SalaryEntry } from "../../types";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";

interface Props {
  initial?: SalaryEntry;
  onSaved: () => void;
  onCancel: () => void;
}

export function SalaryForm({ initial, onSaved, onCancel }: Props) {
  const [month, setMonth] = useState(initial?.month ?? "");
  const [payday, setPayday] = useState(initial?.payday?.toString() ?? "25");
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const numericAmount = Number(amount);
    if (!month || !numericAmount || numericAmount <= 0) return;

    if (!initial) {
      const existing = await db.salaries.where("month").equals(month).first();
      if (existing) {
        setError("この月の給与はすでに登録されています。一覧から編集してください。");
        return;
      }
    }

    setSaving(true);
    const record: SalaryEntry = {
      month,
      payday: Math.min(31, Math.max(1, Number(payday) || 1)),
      amount: numericAmount,
      // This form has no UI for itemized deductions — carry forward whatever
      // a CSV import previously set rather than silently wiping it on edit.
      grossAmount: initial?.grossAmount,
      deductions: initial?.deductions,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (initial?.id) {
      await db.salaries.put({ ...record, id: initial.id });
    } else {
      await db.salaries.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="対象月" type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
      <Input
        label="給料日(毎月)"
        type="number"
        inputMode="numeric"
        value={payday}
        onChange={(e) => setPayday(e.target.value)}
        min={1}
        max={31}
      />
      <Input
        label="給与額"
        type="number"
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
        min={1}
      />
      {error && <p className="text-sm text-danger">{error}</p>}

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
