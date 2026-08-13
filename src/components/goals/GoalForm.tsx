import { useState } from "react";
import { db } from "../../db/schema";
import type { Goal } from "../../types";
import { GOAL_CATEGORIES } from "../../lib/categories";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="目標" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      <Select label="カテゴリ" value={category} onChange={(e) => setCategory(e.target.value)}>
        {GOAL_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      <Input label="期限" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={useAmount}
          onChange={(e) => setUseAmount(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
        />
        金額で進捗を管理する(例: 貯金目標)
      </label>

      {useAmount ? (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="目標金額"
            type="number"
            inputMode="numeric"
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
          />
          <Input
            label="現在の金額"
            type="number"
            inputMode="numeric"
            value={currentAmount}
            onChange={(e) => setCurrentAmount(e.target.value)}
          />
        </div>
      ) : (
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-600">進捗率: {progress}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            className="w-full accent-accent"
          />
        </div>
      )}

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
