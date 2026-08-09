import { useState } from "react";
import { db } from "../../db/schema";
import type { CalendarEvent, ScheduleCategory } from "../../types";
import { SCHEDULE_CATEGORIES } from "../../lib/scheduleCategories";
import { Input, Textarea } from "../ui/Input";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";

interface Props {
  initial?: CalendarEvent;
  defaultDate: string;
  onSaved: () => void;
  onCancel: () => void;
}

const NOTIFY_OPTIONS = [
  { value: "", label: "通知しない" },
  { value: "5", label: "5分前" },
  { value: "10", label: "10分前" },
  { value: "30", label: "30分前" },
  { value: "60", label: "1時間前" },
  { value: "1440", label: "前日" },
];

export function EventForm({ initial, defaultDate, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [category, setCategory] = useState<ScheduleCategory>(initial?.category ?? "other");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [notify, setNotify] = useState(initial?.notifyMinutesBefore?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    const record: CalendarEvent = {
      title: title.trim(),
      date,
      allDay,
      startTime: allDay ? undefined : startTime || undefined,
      endTime: allDay ? undefined : endTime || undefined,
      category,
      location: location || undefined,
      memo: memo || undefined,
      // All-day events have no clock time to count down from, so a
      // time-based notification can never fire correctly — drop it
      // rather than storing a value that silently does nothing.
      notifyMinutesBefore: allDay || !notify ? undefined : Number(notify),
      notifiedAt: undefined,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (initial?.id) {
      await db.calendarEvents.update(initial.id, record);
    } else {
      await db.calendarEvents.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="タイトル" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      <Input label="日付" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
        />
        終日
      </label>

      {!allDay && (
        <div className="grid grid-cols-2 gap-3">
          <Input label="開始時刻" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <Input label="終了時刻" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
      )}

      <Select
        label="カテゴリ"
        value={category}
        onChange={(e) => setCategory(e.target.value as ScheduleCategory)}
      >
        {SCHEDULE_CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>

      <Input label="場所" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="任意" />
      {!allDay && (
        <Select label="通知" value={notify} onChange={(e) => setNotify(e.target.value)}>
          {NOTIFY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
      <Textarea label="メモ" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="任意" />

      <div className="flex gap-3 pt-2">
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
