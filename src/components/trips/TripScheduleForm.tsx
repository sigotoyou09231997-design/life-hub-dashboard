import { useState } from "react";
import { db } from "../../db/schema";
import type { TripScheduleItem, TripScheduleType } from "../../types";
import { TRIP_SCHEDULE_TYPES } from "../../lib/tripCategories";
import { MapPinned } from "lucide-react";
import { Input, Textarea } from "../ui/Input";
import { Select } from "../ui/Select";
import { DateField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

interface Props {
  tripId: string;
  initial?: TripScheduleItem;
  defaultDate: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function TripScheduleForm({ tripId, initial, defaultDate, onSaved, onCancel }: Props) {
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [type, setType] = useState<TripScheduleType>(initial?.type ?? "sightseeing");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    const record: TripScheduleItem = {
      tripId,
      date,
      startTime: startTime || undefined,
      title: title.trim(),
      location: location || undefined,
      memo: memo || undefined,
      type,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (initial?.id) {
      await db.tripSchedule.update(initial.id, record);
    } else {
      await db.tripSchedule.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="何をする" icon={MapPinned}>
        <Input
          label="タイトル"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 五稜郭"
          required
          autoFocus
        />
        <Select label="種類" value={type} onChange={(e) => setType(e.target.value as TripScheduleType)}>
          {TRIP_SCHEDULE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </FormPanel>

      <FormPanel caption="いつ・どこで">
        <DateField label="日付" value={date} onChange={setDate} />
        <Input
          label="開始時刻"
          optional
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
        />
        <Input
          label="場所"
          optional
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="例: 函館市元町"
        />
        <Textarea label="メモ" optional value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "予定を追加"}
        </Button>
      </FormActions>
    </form>
  );
}
