import { useState } from "react";
import { db } from "../../db/schema";
import type { TripScheduleItem, TripScheduleType } from "../../types";
import { TRIP_SCHEDULE_TYPES } from "../../lib/tripCategories";
import { Input, Textarea } from "../ui/Input";
import { Select } from "../ui/Select";
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="タイトル" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      <div className="grid grid-cols-2 gap-3">
        <Input label="日付" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <Input label="開始時刻(任意)" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
      </div>
      <Select label="種類" value={type} onChange={(e) => setType(e.target.value as TripScheduleType)}>
        {TRIP_SCHEDULE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <Input label="場所" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="任意" />
      <Textarea label="メモ" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="任意" />

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
