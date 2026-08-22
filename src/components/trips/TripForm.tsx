import { useState } from "react";
import { CalendarRange, MapPin, Plane, Check, Sparkles } from "lucide-react";
import { db } from "../../db/schema";
import type { Trip, TripStatus } from "../../types";
import { todayStr } from "../../lib/date";
import { Input, Textarea, AmountInput } from "../ui/Input";
import { SegmentedField } from "../ui/SegmentedField";
import { DateRangeField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

interface Props {
  initial?: Trip;
  onSaved: (id: string) => void;
  onCancel: () => void;
}

const STATUS_OPTIONS = [
  { value: "planning" as TripStatus, label: "計画中", icon: Sparkles },
  { value: "ongoing" as TripStatus, label: "旅行中", icon: Plane },
  { value: "completed" as TripStatus, label: "完了", icon: Check },
];

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

    let id: string;
    if (initial?.id) {
      await db.trips.update(initial.id, record);
      id = initial.id;
    } else {
      id = (await db.trips.add(record)) as string;
    }
    setSaving(false);
    onSaved(id);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="どこへ" icon={MapPin}>
        <Input
          label="旅行名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 夏の北海道"
          required
          autoFocus
        />
        <Input
          label="主な行き先"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="例: 北海道・函館"
          required
        />
      </FormPanel>

      <FormPanel caption="いつ" icon={CalendarRange}>
        <DateRangeField
          label="日程"
          start={startDate}
          end={endDate}
          onChangeStart={(value) => {
            setStartDate(value);
            // 開始を終了より後ろにずらしたら、終了も一緒に動かす。手で直させない。
            if (endDate < value) setEndDate(value);
          }}
          onChangeEnd={setEndDate}
          error={error}
        />
        <SegmentedField label="いまの状態" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
      </FormPanel>

      <FormPanel caption="そのほか">
        <AmountInput
          label="予算"
          optional
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          min={0}
          placeholder="0"
        />
        <Textarea
          label="メモ"
          optional
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={2}
          placeholder="持っていくもの、調べたことなど"
        />
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "旅行を追加"}
        </Button>
      </FormActions>
    </form>
  );
}
