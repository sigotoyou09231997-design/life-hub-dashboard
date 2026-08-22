import { useState } from "react";
import { db } from "../../db/schema";
import type { Goal } from "../../types";
import { GOAL_CATEGORIES } from "../../lib/categories";
import { Target } from "lucide-react";
import { Input, AmountInput } from "../ui/Input";
import { Select } from "../ui/Select";
import { SwitchField } from "../ui/SwitchField";
import { DateField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Field } from "../ui/Field";
import { Button } from "../ui/Button";

interface Props {
  initial?: Goal;
  onSaved: () => void;
  onCancel: () => void;
}

export function GoalForm({ initial, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? GOAL_CATEGORIES[0]);
  const [deadline, setDeadline] = useState(initial?.deadline ?? "");
  const [useAmount, setUseAmount] = useState(initial?.targetAmount != null);
  const [targetAmount, setTargetAmount] = useState(initial?.targetAmount?.toString() ?? "");
  const [currentAmount, setCurrentAmount] = useState(initial?.currentAmount?.toString() ?? "0");
  const [progress, setProgress] = useState(initial?.progress ?? 0);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    const target = useAmount ? Number(targetAmount) || 0 : undefined;
    const current = useAmount ? Number(currentAmount) || 0 : undefined;
    const computedProgress =
      useAmount && target ? Math.min(100, Math.round((current! / target) * 100)) : progress;

    const record: Goal = {
      title: title.trim(),
      category,
      deadline: deadline || undefined,
      targetAmount: target,
      currentAmount: current,
      progress: computedProgress,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (initial?.id) {
      await db.goals.update(initial.id, record);
    } else {
      await db.goals.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="何を目指す" icon={Target}>
        <Input
          label="目標"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 旅行資金を貯める"
          required
          autoFocus
        />
        <Select label="カテゴリ" value={category} onChange={(e) => setCategory(e.target.value)}>
          {GOAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <DateField label="期限" optional value={deadline} onChange={setDeadline} placeholder="期限なし" />
      </FormPanel>

      <FormPanel caption="進み具合の数え方">
        <SwitchField
          label="金額で数える"
          hint="貯金のように、目標額に対していくら貯まったかで進み具合を出します。"
          checked={useAmount}
          onChange={setUseAmount}
        />
        {useAmount ? (
          <>
            <AmountInput
              label="目標金額"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
              min={0}
              placeholder="0"
            />
            <AmountInput
              label="いま貯まっている額"
              value={currentAmount}
              onChange={(e) => setCurrentAmount(e.target.value)}
              min={0}
              placeholder="0"
            />
          </>
        ) : (
          <Field label="進み具合" as="div">
            <div className="progress-field">
              <input
                type="range"
                min={0}
                max={100}
                value={progress}
                aria-label="進み具合"
                onChange={(e) => setProgress(Number(e.target.value))}
              />
              <strong>{progress}%</strong>
            </div>
          </Field>
        )}
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "目標を追加"}
        </Button>
      </FormActions>
    </form>
  );
}
