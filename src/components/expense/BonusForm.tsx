import { useState } from "react";
import { db } from "../../db/schema";
import type { Transaction } from "../../types";
import { todayStr } from "../../lib/date";
import { BONUS_CATEGORY } from "../../lib/bonus";
import { AmountInput, Input } from "../ui/Input";
import { DateField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

interface Props {
  initial?: Transaction;
  onSaved: () => void;
  onCancel: () => void;
}

/** 賞与の登録。中身は「収入 / ボーナス」の収支1件(src/lib/bonus.ts)なので、
 * 履歴タブにもそのまま並ぶ。 */
export function BonusForm({ initial, onSaved, onCancel }: Props) {
  const [amount, setAmount] = useState(initial?.amount ? initial.amount.toString() : "");
  const [date, setDate] = useState(initial?.date ?? todayStr());
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) return;

    setSaving(true);
    const record: Transaction = {
      type: "income",
      amount: numericAmount,
      category: BONUS_CATEGORY,
      memo,
      date,
      isFixed: false,
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
      <FormPanel caption="いくら・いつ">
        <AmountInput
          label="金額"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          min={1}
          autoFocus
        />
        <DateField label="支給日" value={date} onChange={setDate} />
        <Input
          label="メモ"
          optional
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="例: 夏季賞与"
        />
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "登録する"}
        </Button>
      </FormActions>
    </form>
  );
}
