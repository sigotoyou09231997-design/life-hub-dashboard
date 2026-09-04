import { useEffect, useState } from "react";
import { db } from "../../db/schema";
import type { TripExpense, TripExpenseCategory } from "../../types";
import { TRIP_EXPENSE_CATEGORIES } from "../../lib/tripCategories";
import {
  CURRENCIES,
  EMPTY_CURRENCY_DRAFT,
  HOME_CURRENCY,
  currencyLabel,
  draftToYen,
  fetchRateToYen,
  isRateFetchable,
  loadCurrencyDraft,
  saveCurrencyDraft,
  type TripExpenseCurrencyDraft,
} from "../../lib/currency";
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
  const [currency, setCurrency] = useState<TripExpenseCurrencyDraft>(EMPTY_CURRENCY_DRAFT);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState("");
  const [saving, setSaving] = useState(false);

  // 現地通貨の内訳は支出の行と別のテーブルにあるので、開いたときに読み直す
  // (src/lib/currency.ts)。
  const initialId = initial?.id;
  useEffect(() => {
    if (!initialId) return;
    let alive = true;
    loadCurrencyDraft(initialId).then((draft) => {
      if (alive) setCurrency(draft);
    });
    return () => {
      alive = false;
    };
  }, [initialId]);

  /** 通貨を選び直したら、その通貨のレートを取りに行く(手で入れ直せる)。 */
  async function changeCurrency(code: string) {
    setRateError("");
    if (code === HOME_CURRENCY) {
      setCurrency(EMPTY_CURRENCY_DRAFT);
      return;
    }
    setCurrency((current) => ({ ...current, currency: code, rate: "", manual: false }));
    if (!isRateFetchable(code)) {
      setRateError(`${currencyLabel(code)}のレートは自動で取れないので、手で入れてください。`);
      return;
    }
    setRateLoading(true);
    const rate = await fetchRateToYen(code);
    setRateLoading(false);
    if (rate == null) {
      setRateError("レートを取れませんでした。手で入れてください。");
      return;
    }
    setCurrency((current) => (current.currency === code ? { ...current, rate: String(rate), manual: false } : current));
  }

  // 現地通貨で入れている間は、円の金額はこちらで決める(手では触らせない) —
  // 2か所から書けると、どちらが本当の金額か分からなくなる。
  const convertedYen = draftToYen(currency);
  const usingForeign = currency.currency !== HOME_CURRENCY;
  const effectiveAmount = usingForeign ? convertedYen : Number(amount);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !effectiveAmount || effectiveAmount <= 0) return;

    setSaving(true);
    const record: TripExpense = {
      tripId,
      title: title.trim(),
      // 合計・予算はこれまでどおり円(amount)だけを見る。
      amount: effectiveAmount,
      category,
      paidDate: paidDate || undefined,
      paid,
      memo: memo || undefined,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    // 新しい支出にはまだidが無く、内訳の貼り先を決められない。保存して得たidに
    // 向けて、そのあとで書く(src/lib/currency.ts)。
    let expenseId: string;
    if (initial?.id) {
      expenseId = initial.id;
      await db.tripExpenses.update(expenseId, record);
    } else {
      expenseId = String(await db.tripExpenses.add(record));
    }
    await saveCurrencyDraft(expenseId, currency);
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

        <Select label="通貨" value={currency.currency} onChange={(e) => void changeCurrency(e.target.value)}>
          <option value={HOME_CURRENCY}>日本円</option>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}({c.code})
            </option>
          ))}
        </Select>

        {usingForeign ? (
          <>
            {/* AmountInput は ¥ を固定の飾りとして持つので、現地通貨には使わない。 */}
            <Input
              label={`金額(${currency.currency})`}
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={currency.originalAmount}
              onChange={(e) => setCurrency({ ...currency, originalAmount: e.target.value })}
              required
              placeholder="0"
            />
            <Input
              label="レート(1通貨あたりの円)"
              type="number"
              inputMode="decimal"
              step="0.0001"
              min={0}
              value={currency.rate}
              onChange={(e) => setCurrency({ ...currency, rate: e.target.value, manual: true })}
              required
              placeholder={rateLoading ? "取得中…" : "例: 171.5"}
              hint={
                rateError ||
                (currency.manual
                  ? "手で入れたレートを使います。"
                  : "自動で入れた当日のレートです。カードの実際のレートに合わせて直せます。")
              }
            />
            <p className="trip-expense-form__converted">
              円に直すと <strong>{convertedYen != null ? `¥${convertedYen.toLocaleString()}` : "—"}</strong>
              <span>合計や予算にはこの金額が入ります。</span>
            </p>
          </>
        ) : (
          <AmountInput
            label="金額"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            min={1}
            placeholder="0"
          />
        )}

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
