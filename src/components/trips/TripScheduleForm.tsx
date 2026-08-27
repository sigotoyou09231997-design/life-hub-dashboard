import { useState } from "react";
import { db } from "../../db/schema";
import type { TripScheduleItem, TripScheduleType } from "../../types";
import { TRIP_SCHEDULE_TYPES } from "../../lib/tripCategories";
import { MapPinned } from "lucide-react";
import { Input, Textarea } from "../ui/Input";
import { Select } from "../ui/Select";
import { DateRangeField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";
import { isMultiDay, normalizeEndDate, shiftEndDate, spanDays } from "../../lib/eventSpan";

interface Props {
  tripId: string;
  initial?: TripScheduleItem;
  defaultDate: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function TripScheduleForm({ tripId, initial, defaultDate, onSaved, onCancel }: Props) {
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  /** 終了日。宿泊のように何日かにまたがるものだけ入れる(空＝その日で終わる)。 */
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [type, setType] = useState<TripScheduleType>(initial?.type ?? "sightseeing");
  const [saving, setSaving] = useState(false);

  /** 開始日を動かしたら、終了日も同じ日数ぶん一緒に動かす(src/lib/eventSpan.ts)。 */
  function changeDate(next: string) {
    setEndDate((current) => shiftEndDate(date, next, current));
    setDate(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    const record: TripScheduleItem = {
      tripId,
      date,
      endDate: normalizeEndDate(date, endDate),
      startTime: startTime || undefined,
      endTime: endTime || undefined,
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
        <DateRangeField
          label="日付"
          start={date}
          end={endDate}
          onChangeStart={changeDate}
          onChangeEnd={setEndDate}
          endPlaceholder="同じ日に終わる"
          advanceToEnd={false}
          summaryText={
            isMultiDay({ date, endDate })
              ? `${spanDays({ date, endDate })}日間・その間の日すべての日程に出ます`
              : ""
          }
        />
        <Input
          label="開始時刻"
          optional
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
        />
        {/* 移動なら到着時刻。メールから取り込んだ分もここで直せる。 */}
        <Input
          label="終了時刻"
          optional
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
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
