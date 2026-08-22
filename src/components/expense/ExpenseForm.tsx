import { useState } from "react";
import { db } from "../../db/schema";
import type { Transaction, TransactionType } from "../../types";
import { todayStr } from "../../lib/date";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from "../../lib/categories";
import { Wallet, Store } from "lucide-react";
import { Input, Textarea, AmountInput } from "../ui/Input";
import { Select } from "../ui/Select";
import { SegmentedField } from "../ui/SegmentedField";
import { SwitchField } from "../ui/SwitchField";
import { DateField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="いくら" icon={Wallet}>
        <SegmentedField
          label="種類"
          value={type}
          options={[
            { value: "expense" as TransactionType, label: "支出" },
            { value: "income" as TransactionType, label: "収入" },
          ]}
          onChange={handleTypeChange}
        />
        <AmountInput
          label="金額"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          min={1}
          autoFocus
        />
        <Select label="カテゴリ" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <DateField label="日付" value={date} onChange={setDate} />
      </FormPanel>

      {type === "expense" && (
        <FormPanel caption="どこで・どうやって" icon={Store}>
          <Select label="支払い方法" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Input
            label="店舗"
            optional
            value={store}
            onChange={(e) => setStore(e.target.value)}
            placeholder="例: いつものスーパー"
          />
          <SwitchField
            label="固定費の支払いとして記録する"
            hint="使えるお金の計算から外します。"
            checked={isFixed}
            onChange={setIsFixed}
          />
        </FormPanel>
      )}

      <FormPanel>
        <Textarea label="メモ" optional value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "記録する"}
        </Button>
      </FormActions>
    </form>
  );
}
