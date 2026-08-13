import { useState } from "react";
import { db } from "../../db/schema";
import type { Transaction, TransactionType } from "../../types";
import { todayStr } from "../../lib/date";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from "../../lib/categories";
import { Input, Textarea } from "../ui/Input";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";
import { Tabs } from "../ui/Tabs";

interface Props {
  initial?: Transaction;
  defaultType?: TransactionType;
  onSaved: () => void;
  onCancel: () => void;
}

export function ExpenseForm({ initial, defaultType = "expense", onSaved, onCancel }: Props) {
  const [type, setType] = useState<TransactionType>(initial?.type ?? defaultType);
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? "");
  const [category, setCategory] = useState(
    initial?.category ?? (type === "expense" ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]),
  );
  const [method, setMethod] = useState(initial?.method ?? PAYMENT_METHODS[0]);
  const [store, setStore] = useState(initial?.store ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [date, setDate] = useState(initial?.date ?? todayStr());
  const [isFixed, setIsFixed] = useState(initial?.isFixed ?? false);
  const [saving, setSaving] = useState(false);

  const categories = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  function handleTypeChange(next: TransactionType) {
    setType(next);
    setCategory(next === "expense" ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) return;

    setSaving(true);
    const record: Transaction = {
      type,
      amount: numericAmount,
      category,
      method: type === "expense" ? method : undefined,
      store: type === "expense" ? store : undefined,
      memo,
      date,
      isFixed: type === "expense" ? isFixed : false,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (initial?.id) {
      await db.transactions.update(initial.id, record);
    } else {
      await db.transactions.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Tabs
        options={[
          { value: "expense", label: "支出" },
          { value: "income", label: "収入" },
        ]}
        value={type}
        onChange={handleTypeChange}
      />

      <Input
        label="金額"
        type="number"
        inputMode="numeric"
        placeholder="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
        min={1}
      />

      <Select label="カテゴリ" value={category} onChange={(e) => setCategory(e.target.value)}>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>

      <Input label="日付" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />

      {type === "expense" && (
        <>
          <Select label="支払い方法" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Input label="店舗" value={store} onChange={(e) => setStore(e.target.value)} placeholder="任意" />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={isFixed}
              onChange={(e) => setIsFixed(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
            />
            固定費の支払いとして記録する(予算計算から除外)
          </label>
        </>
      )}

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
