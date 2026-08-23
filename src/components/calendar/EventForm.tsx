import { useState } from "react";
import { CalendarDays, Tag } from "lucide-react";
import { db } from "../../db/schema";
import type { CalendarEvent, ScheduleCategory } from "../../types";
import { SCHEDULE_CATEGORIES } from "../../lib/scheduleCategories";
import { Input, Textarea } from "../ui/Input";
import { Select } from "../ui/Select";
import { SegmentedField } from "../ui/SegmentedField";
import { DateField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Field } from "../ui/Field";
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

const SPAN_OPTIONS = [
  { value: "timed", label: "時間を決める" },
  { value: "allday", label: "終日" },
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="何の予定" icon={CalendarDays}>
        <Input
          label="タイトル"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 歯医者"
          required
          autoFocus
        />
      </FormPanel>

      <FormPanel caption="いつ">
        <DateField label="日付" value={date} onChange={setDate} />
        <SegmentedField
          label="時間"
          value={allDay ? "allday" : "timed"}
          options={SPAN_OPTIONS}
          onChange={(value) => setAllDay(value === "allday")}
        />
        {!allDay && (
          <Field label="開始 → 終了" as="div">
            <div className="range-field range-field--time">
              <input
                type="time"
                aria-label="開始時刻"
                className="field-shell"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
              <span className="range-field__arrow" aria-hidden="true">
                〜
              </span>
              <input
                type="time"
                aria-label="終了時刻"
                className="field-shell"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </Field>
        )}
        {!allDay && (
          <Select label="通知" value={notify} onChange={(e) => setNotify(e.target.value)}>
            {NOTIFY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </FormPanel>

      <FormPanel caption="そのほか" icon={Tag}>
        <Select label="カテゴリ" value={category} onChange={(e) => setCategory(e.target.value as ScheduleCategory)}>
          {SCHEDULE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <Input
          label="場所"
          optional
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="例: 駅前クリニック"
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
