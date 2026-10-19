import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft } from "lucide-react";
import { db } from "../../db/schema";
import type { BillingCycle, FixedCost, FixedCostAmountChange } from "../../types";
import { FIXED_COST_CATEGORIES } from "../../lib/categories";
import { changeDiff, changeDiffLabel, sortChanges } from "../../lib/fixedCostHistory";
import { formatDisplayDate, toDateStr, todayStr } from "../../lib/date";
import { daysUntil, nextBillingDate, remainingLabel, type SubscriptionItem } from "../../lib/subscriptions";
import type { SubscriptionTemplate } from "../../lib/subscriptionTemplates";
import { saveSubscription } from "../../lib/subscriptionStore";
import { Input, AmountInput } from "../ui/Input";
import { DateField } from "../ui/DateField";
import { Field } from "../ui/Field";
import { SegmentedField } from "../ui/SegmentedField";
import { SwitchField } from "../ui/SwitchField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";
import { ServiceIcon } from "./ServiceIcon";
import { isClaudeSubscription } from "../../lib/anthropicBilling";
import { ClaudePriceHint } from "./ClaudePriceHint";

type NotifyValue = "none" | "0" | "1" | "3" | "7";

const NOTIFY_OPTIONS: { value: NotifyValue; label: string }[] = [
  { value: "none", label: "しない" },
  { value: "0", label: "当日" },
  { value: "1", label: "前日" },
  { value: "3", label: "3日前" },
  { value: "7", label: "1週間前" },
];

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }));

interface Props {
  initial?: SubscriptionItem;
  /** 「人気サービスから追加」で選んだお手本。新しく追加するときだけ。 */
  template?: SubscriptionTemplate | null;
  onSaved: () => void;
  onCancel: () => void;
  /** 追加のときの「サービスを選び直す」。 */
  onBack?: () => void;
}

/**
 * サブスク(固定費)の追加・編集。2026-10-12 に FixedCostForm を作り替えた。
 * 選択肢はプルダウンにせずボタンで並べる — シートの中のプルダウンは iPhone で選択肢が
 * 離れて出ることがあるため(2026-10-11)。
 */
export function SubscriptionForm({ initial, template, onSaved, onCancel, onBack }: Props) {
  const cost = initial?.cost;
  const detail = initial?.detail;
  const today = todayStr();

  const [title, setTitle] = useState(cost?.title ?? template?.service ?? "");
  const [category, setCategory] = useState(cost?.category ?? template?.category ?? FIXED_COST_CATEGORIES[0]);
  const [amount, setAmount] = useState(cost?.amount?.toString() ?? template?.price.toString() ?? "");
  const [cycle, setCycle] = useState<BillingCycle>(detail?.cycle ?? template?.cycle ?? "monthly");
  const [dueDay, setDueDay] = useState(cost?.dueDay?.toString() ?? String(Number(today.slice(8, 10))));
  const [billingMonth, setBillingMonth] = useState(String(detail?.billingMonth ?? Number(today.slice(5, 7))));
  const [startDate, setStartDate] = useState(detail?.startDate ?? "");
  const [trial, setTrial] = useState(Boolean(detail?.trialEndDate));
  const [trialEndDate, setTrialEndDate] = useState(detail?.trialEndDate ?? "");
  const [notify, setNotify] = useState<NotifyValue>(
    cost?.notifyDaysBefore != null ? (String(cost.notifyDaysBefore) as NotifyValue) : "none",
  );
  const [saving, setSaving] = useState(false);
  const serviceKey = detail?.serviceKey ?? template?.key ?? null;

  // 金額を変えた記録。この端末で変えたぶんだけ残る(同期していないため)。
  const initialId = cost?.id;
  const changes = useLiveQuery<FixedCostAmountChange[]>(
    () =>
      initialId
        ? db.fixedCostAmountChanges.where("fixedCostId").equals(initialId).toArray().then(sortChanges)
        : Promise.resolve([]),
    [initialId],
  );

  /** 開始日・体験の終わる日を選んだら、その日を請求日にそろえる(多くのサービスはその日に請求する)。 */
  function alignBillingDay(date: string) {
    if (!date) return;
    setDueDay(String(Number(date.slice(8, 10))));
    setBillingMonth(String(Number(date.slice(5, 7))));
  }

  const day = Math.min(31, Math.max(1, Number(dueDay) || 1));
  const preview: SubscriptionItem = {
    cost: { title, category, amount: Number(amount) || 0, dueDay: day, active: true },
    detail: {
      fixedCostId: "",
      cycle,
      billingMonth: Number(billingMonth),
      startDate: startDate || null,
      trialEndDate: trial ? trialEndDate || null : null,
      createdAt: 0,
    },
  };
  const next = nextBillingDate(preview, today);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (!title.trim() || !numericAmount || numericAmount <= 0) return;
    if (trial && !trialEndDate) return;

    setSaving(true);
    const record: FixedCost = {
      title: title.trim(),
      category,
      amount: numericAmount,
      dueDay: day,
      // 解約・再契約はこのフォームでは触らない(シートの下のボタンで行う)。
      active: cost?.active ?? true,
      notifyDaysBefore: notify === "none" ? undefined : Number(notify),
      // 通知済みの印はこのフォームでは触らない — 無関係な項目を直しただけで、今月
      // 分の通知が二重に飛ぶ・逆に飛ばなくなるのを避ける。
      lastNotifiedMonth: cost?.lastNotifiedMonth,
    };
    await saveSubscription(
      record,
      {
        cycle,
        billingMonth: cycle === "yearly" ? Number(billingMonth) : null,
        serviceKey,
        startDate: startDate || null,
        trialEndDate: trial ? trialEndDate : null,
        cancelledAt: detail?.cancelledAt ?? null,
      },
      cost,
    );
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="subs-form flex flex-col gap-4">
      {onBack && (
        <button type="button" className="subs-link subs-picker__back" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden="true" /> サービスを選び直す
        </button>
      )}

      <div className="subs-form__preview">
        <ServiceIcon title={title || "?"} serviceKey={serviceKey} size="lg" />
        <div className="min-w-0">
          <strong>{title || "名前を入れてください"}</strong>
          {next && (
            <span className="subs-form__preview-next">
              次の請求 {formatDisplayDate(next)} · {remainingLabel(daysUntil(next, today))}
            </span>
          )}
        </div>
      </div>

      <FormPanel caption="何の支払い">
        <Input
          label="名前"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: Netflix、家賃"
          required
          autoFocus={!template && !initial}
        />
        <Field label="カテゴリ" as="div">
          <div className="subs-chips subs-chips--wrap">
            {FIXED_COST_CATEGORIES.map((name) => (
              <button
                key={name}
                type="button"
                className="subs-chip"
                aria-pressed={category === name}
                onClick={() => setCategory(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </Field>
      </FormPanel>

      <FormPanel caption="いくら・いつ">
        <SegmentedField<BillingCycle>
          label="払い方"
          value={cycle}
          onChange={setCycle}
          separate
          options={[
            { value: "monthly", label: "毎月" },
            { value: "yearly", label: "毎年" },
          ]}
        />
        <AmountInput
          label={cycle === "yearly" ? "1年の金額" : "毎月の金額"}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          min={1}
          placeholder="0"
        />
        {/* Claude はドルで請求されて消費税が足されるので、登録の金額を税抜・消費税に分けて見せ、為替だけの額と比べる。 */}
        {isClaudeSubscription(title, serviceKey) && <ClaudePriceHint amount={amount} serviceKey={serviceKey} />}
        {cycle === "yearly" && (
          <SegmentedField
            label="請求の月"
            value={billingMonth}
            onChange={setBillingMonth}
            separate
            columns={6}
            options={MONTH_OPTIONS}
          />
        )}
        <Input
          label={cycle === "yearly" ? "請求の日" : "請求日(毎月)"}
          hint={
            next
              ? `次の請求は ${formatDisplayDate(next)}(${remainingLabel(daysUntil(next, today))})。29〜31日は、その日が無い月は月末で数えます。`
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

      <FormPanel caption="契約・無料体験">
        <DateField
          label="契約を始めた日"
          optional
          hint="この日より前の請求は数えません。先の日付にすると「開始予定」になり、始まるまで合計に入りません。"
          value={startDate}
          onChange={(value) => {
            setStartDate(value);
            alignBillingDay(value);
          }}
        />
        <SwitchField
          label="無料体験中"
          hint="終わる日から請求が始まるものとして数えます。それまでは合計に入りません。"
          checked={trial}
          onChange={setTrial}
        />
        {trial && (
          <DateField
            label="無料体験が終わる日"
            value={trialEndDate}
            onChange={(value) => {
              setTrialEndDate(value);
              alignBillingDay(value);
            }}
            error={!trialEndDate ? "終わる日を選んでください" : undefined}
          />
        )}
      </FormPanel>

      <FormPanel caption="通知">
        <SegmentedField<NotifyValue>
          label="請求日の前に知らせる"
          hint="設定でバックグラウンド通知を有効にしている端末に届きます。無料体験中は、終わる日の前に届きます。"
          value={notify}
          onChange={setNotify}
          separate
          columns={3}
          options={NOTIFY_OPTIONS}
        />
      </FormPanel>

      {changes && changes.length > 0 && (
        <FormPanel caption="金額の変わりかた">
          <ul className="space-y-2">
            {changes.map((change) => {
              const diff = changeDiff(change);
              return (
                <li key={change.id} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="shrink-0 text-slate-400">
                    {formatDisplayDate(toDateStr(new Date(change.changedAt)))}
                  </span>
                  <span className="min-w-0 text-right tabular-nums text-slate-600">
                    ¥{change.previousAmount.toLocaleString()} → ¥{change.amount.toLocaleString()}{" "}
                    <span className={diff > 0 ? "font-semibold text-danger" : "font-semibold text-success"}>
                      {changeDiffLabel(change)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-slate-400">
            この端末で金額を変えたぶんだけ残ります(他の端末での変更は入りません)。
          </p>
        </FormPanel>
      )}

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
