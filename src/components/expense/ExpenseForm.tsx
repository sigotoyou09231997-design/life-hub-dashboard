import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Transaction, TransactionType } from "../../types";
import { todayStr } from "../../lib/date";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from "../../lib/categories";
import { collectStoreSamples, guessCategoryFromStore } from "../../lib/storeCategory";
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
  /** 保存ボタンの文言。レシート読み取りからの確認画面など、initialはあっても
   * 「新規追加」扱いにしたい呼び出し元向け(既定はinitialの有無で決める今までどおり)。 */
  submitLabel?: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function ExpenseForm({ initial, defaultType = "expense", submitLabel, onSaved, onCancel }: Props) {
  const [type, setType] = useState<TransactionType>(initial?.type ?? defaultType);
  // amount: 0(レシート読み取りで金額が読めなかった時の仮値)は未入力と同じ扱いにする —
  // 「0」が入ったまま出すより、空欄で金額の入力を促す方がよい。
  const [amount, setAmount] = useState(initial?.amount ? initial.amount.toString() : "");
  const [category, setCategory] = useState(
    initial?.category ?? (type === "expense" ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]),
  );
  const [method, setMethod] = useState(initial?.method ?? PAYMENT_METHODS[0]);
  const [store, setStore] = useState(initial?.store ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [date, setDate] = useState(initial?.date ?? todayStr());
  const [isFixed, setIsFixed] = useState(initial?.isFixed ?? false);
  const [saving, setSaving] = useState(false);

  // 店名からカテゴリを推測する材料。過去の支出はそう多くないので全件から作る。
  const pastTransactions = useLiveQuery(() => db.transactions.toArray(), []);
  const storeSamples = collectStoreSamples(pastTransactions ?? []);
  const guess = type === "expense" ? guessCategoryFromStore(storeSamples, store) : null;

  // 自分でカテゴリを選んだあとは推測で上書きしない。編集中の記録も、既に選んだ
  // カテゴリがあるので触らない。
  const categoryTouched = useRef(initial != null);
  const appliedGuessFor = useRef<string | null>(null);
  useEffect(() => {
    if (categoryTouched.current || !guess) return;
    if (appliedGuessFor.current === guess.category) return;
    appliedGuessFor.current = guess.category;
    setCategory(guess.category);
  }, [guess?.category]); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  function handleTypeChange(next: TransactionType) {
    setType(next);
    setCategory(next === "expense" ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]);
  }

  function handleCategoryChange(next: string) {
    categoryTouched.current = true;
    setCategory(next);
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
        <Select label="カテゴリ" value={category} onChange={(e) => handleCategoryChange(e.target.value)}>
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
          <div>
            <Input
              label="店舗"
              optional
              value={store}
              onChange={(e) => setStore(e.target.value)}
              placeholder="例: いつものスーパー"
            />
            {/* 過去に同じ店で選んだカテゴリ。まだ自分で選んでいなければ上のカテゴリに
                入れてあり、選んだあとは押して入れ替えられるようにする。 */}
            {guess && (
              guess.category === category ? (
                <p className="mt-1.5 text-xs text-slate-500">
                  「{guess.matchedStore}」の過去{guess.matchedCount}件から
                  <span className="font-semibold text-slate-700">{guess.category}</span>にしています
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => handleCategoryChange(guess.category)}
                  className="mt-1.5 text-xs font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  「{guess.matchedStore}」では{guess.category}が多いです。{guess.category}にする
                </button>
              )
            )}
          </div>
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
          {submitLabel ?? (initial ? "変更を保存" : "記録する")}
        </Button>
      </FormActions>
    </form>
  );
}
