import { useState } from "react";
import { db } from "../../db/schema";
import type { Trip, TripStatus } from "../../types";
import { todayStr } from "../../lib/date";
import { Input, Textarea } from "../ui/Input";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";

interface Props {
  initial?: Trip;
  onSaved: (id: number) => void;
  onCancel: () => void;
}

const STATUS_LABEL: Record<TripStatus, string> = {
  planning: "計画中",
  ongoing: "旅行中",
  completed: "完了",
};

export function TripForm({ initial, onSaved, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? todayStr());
  const [endDate, setEndDate] = useState(initial?.endDate ?? todayStr());
  const [status, setStatus] = useState<TripStatus>(initial?.status ?? "planning");
  const [budget, setBudget] = useState(initial?.budget?.toString() ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !destination.trim()) return;
    if (endDate < startDate) {
      setError("終了日は開始日より後の日付にしてください。");
      return;
    }

    setSaving(true);
    const record: Trip = {
      name: name.trim(),
      destination: destination.trim(),
      startDate,
      endDate,
      status,
      budget: budget ? Number(budget) : undefined,
      memo: memo || undefined,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    let id: number;
    if (initial?.id) {
      await db.trips.update(initial.id, record);
      id = initial.id;
    } else {
      id = await db.trips.add(record) as number;
    }
    setSaving(false);
    onSaved(id);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="旅行名" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      <Input
        label="主な行き先"
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
        placeholder="例: 京都"
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <Input label="開始日" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        <Input label="終了日" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
      </div>
      <Select label="ステータス" value={status} onChange={(e) => setStatus(e.target.value as TripStatus)}>
        {(["planning", "ongoing", "completed"] as TripStatus[]).map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </Select>
      <Input
        label="予算(任意)"
        type="number"
        inputMode="numeric"
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
        min={0}
      />
      <Textarea label="メモ" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="任意" />

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="sticky bottom-0 -mx-5 flex gap-3 border-t border-slate-100 bg-white px-5 py-3">
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
