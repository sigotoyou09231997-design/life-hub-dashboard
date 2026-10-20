import { useState } from "react";
import type { BillingCycle, FixedCost } from "../../types";
import { FIXED_EXPENSE_CATEGORIES, type FixedCostDraft } from "../../lib/fixedCosts";
import { formatDisplayDate, todayStr } from "../../lib/date";
import { daysUntil, nextBillingDate, remainingLabel, type SubscriptionItem } from "../../lib/subscriptions";
import { saveSubscription } from "../../lib/subscriptionStore";
import { Input, AmountInput } from "../ui/Input";
import { Field } from "../ui/Field";
import { SegmentedField } from "../ui/SegmentedField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

type NotifyValue = "none" | "0" | "1" | "3" | "7";

const NOTIFY_OPTIONS: { value: NotifyValue; label: string }[] = [
  { value: "none", label: "しない" },
  { value: "0", label: "当日" },
  { value: "1", label: "前日" },
  { value: "3", label: "3日前" },
  { value: "7", label: "1週間前" },
];

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }));

/** 種類のボタンに出す名前(「その他の固定費」は、固定費のタブの中なので「その他」で足りる)。 */
const CATEGORY_LABEL: Record<string, string> = { その他の固定費: "その他" };

interface Props {
  initial?: SubscriptionItem;
  /** 新しく足す時に、先に入れておく値(写真・メールから読み取ったもの)。 */
  draft?: FixedCostDraft | null;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * 固定費(家賃・光熱費・保険など)の追加・編集(2026-10-20)。サブスクのフォーム(SubscriptionForm)と違い、
 * サービスを選ぶ段・無料体験・契約開始日は無い。名前・種類・金額・払い方・支払日・通知だけ。
 * 保存先はサブスクと同じ固定費の表(src/lib/subscriptionStore.ts)。種類で「固定費」のタブに並ぶ(src/lib/fixedCosts.ts)。
 */
export function FixedCostForm({ initial, draft, onSaved, onCancel }: Props) {
  const cost = initial?.cost;
  const detail = initial?.detail;
  const today = todayStr();

  const [title, setTitle] = useState(cost?.title ?? draft?.title ?? "");
  const [category, setCategory] = useState(() => {
    const initialCategory = cost?.category ?? draft?.category;
    return initialCategory && FIXED_EXPENSE_CATEGORIES.includes(initialCategory) ? initialCategory : FIXED_EXPENSE_CATEGORIES[0];
  });
  const [amount, setAmount] = useState(cost?.amount?.toString() ?? draft?.amount?.toString() ?? "");
  const [cycle, setCycle] = useState<BillingCycle>(detail?.cycle ?? draft?.cycle ?? "monthly");
  const [dueDay, setDueDay] = useState(cost?.dueDay?.toString() ?? draft?.dueDay?.toString() ?? "27");
  const [billingMonth, setBillingMonth] = useState(
    String(detail?.billingMonth ?? draft?.billingMonth ?? Number(today.slice(5, 7))),
  );
  const [notify, setNotify] = useState<NotifyValue>(
    cost?.notifyDaysBefore != null ? (String(cost.notifyDaysBefore) as NotifyValue) : "none",
  );
  const [saving, setSaving] = useState(false);

  const day = Math.min(31, Math.max(1, Number(dueDay) || 1));
  const next = nextBillingDate(
    {
      cost: { title, category, amount: Number(amount) || 0, dueDay: day, active: true },
      detail: { fixedCostId: "", cycle, billingMonth: Number(billingMonth), createdAt: 0 },
    },
    today,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (!title.trim() || !numericAmount || numericAmount <= 0) return;
    setSaving(true);
    const record: FixedCost = {
      title: title.trim(),
      category,
      amount: numericAmount,
      dueDay: day,
      active: cost?.active ?? true,
      notifyDaysBefore: notify === "none" ? undefined : Number(notify),
      // 通知済みの印はこのフォームでは触らない(サブスクのフォームと同じ理由)。
      lastNotifiedMonth: cost?.lastNotifiedMonth,
    };
    await saveSubscription(
      record,
      {
        cycle,
        billingMonth: cycle === "yearly" ? Number(billingMonth) : null,
        serviceKey: detail?.serviceKey ?? null,
        startDate: detail?.startDate ?? null,
        trialEndDate: null,
        cancelledAt: detail?.cancelledAt ?? null,
      },
      cost,
    );
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="fx-form flex flex-col gap-4">
      <FormPanel caption="何の支払い">
        <Input
          label="名前"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 家賃、電気代、自動車保険"
          required
          autoFocus={!initial && !draft}
        />
        <Field label="種類" as="div">
          <div className="fx-kinds">
            {FIXED_EXPENSE_CATEGORIES.map((name) => (
              <button key={name} type="button" className="fx-kind" aria-pressed={category === name} onClick={() => setCategory(name)}>
                {CATEGORY_LABEL[name] ?? name}
              </button>
            ))}
          </div>
        </Field>
      </FormPanel>

      <FormPanel caption="金額と支払日">
        <SegmentedField<BillingCycle>
          label="払い方"
          value={cycle}
          onChange={setCycle}
          separate
          options={[
            { value: "monthly", label: "毎月" },
            { value: "yearly", label: "年に1回" },
          ]}
        />
        <AmountInput
          label={cycle === "yearly" ? "1回の金額" : "毎月の金額"}
          hint="電気代などで月によって違う時は、だいたいの額を入れてください。"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          min={1}
          placeholder="0"
        />
        {cycle === "yearly" && (
          <SegmentedField label="払う月" value={billingMonth} onChange={setBillingMonth} separate columns={6} options={MONTH_OPTIONS} />
        )}
        <Input
          label={cycle === "yearly" ? "払う日" : "支払日(毎月)"}
          hint={
            next
              ? `次の支払いは ${formatDisplayDate(next)}(${remainingLabel(daysUntil(next, today))})。29〜31日は、その日が無い月は月末で数えます。`
              : undefined
          }
          type="number"
          inputMode="numeric"
          value={dueDay}
          onChange={(e) => setDueDay(e.target.value)}
          min={1}
          max={31}
        />
      </FormPanel>

      <FormPanel caption="通知">
        <SegmentedField<NotifyValue>
          label="支払日の前に知らせる"
          hint="設定でバックグラウンド通知を有効にしている端末に届きます。"
          value={notify}
          onChange={setNotify}
          separate
          columns={3}
          options={NOTIFY_OPTIONS}
        />
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "追加する"}
        </Button>
      </FormActions>
    </form>
  );
}
