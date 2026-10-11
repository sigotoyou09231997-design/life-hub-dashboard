import { useEffect, useState } from "react";
import { db } from "../../db/schema";
import type { TripScheduleItem, TripScheduleType, TripTransportMode } from "../../types";
import { TRIP_SCHEDULE_TYPES, TRIP_TRANSPORT_MODES } from "../../lib/tripCategories";
import { SegmentedField, type SegmentedOption } from "../ui/SegmentedField";
import { TRANSPORT_MODE_ICON } from "./transportModes";
import { ImagePlus, MapPinned } from "lucide-react";
import { loadAttachmentDrafts, saveAttachmentDrafts, type PhotoDraft } from "../../lib/attachments";
import { PhotoField } from "../attachments/PhotoField";
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
  /** 保存した予定の日(開始日)。旅行の画面が、その日へ表示を切り替えるのに使う。 */
  onSaved: (date: string) => void;
  onCancel: () => void;
}

/** 「未定」は空の値。選び直して消せるように、手段と同じ並びに置く。 */
const TRANSPORT_OPTIONS: SegmentedOption<TripTransportMode | "">[] = [
  ...TRIP_TRANSPORT_MODES.map((mode) => ({ value: mode.value, label: mode.label, icon: TRANSPORT_MODE_ICON[mode.value] })),
  { value: "", label: "未定" },
];

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
  /** 何で移動するか。種類が「移動」の時だけ出して、保存する。 */
  const [transportMode, setTransportMode] = useState<TripTransportMode | "">(initial?.transportMode ?? "");
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [saving, setSaving] = useState(false);

  // 貼ってある写真は別のテーブルにあるので、開いた時に読み直す(書類・メモ・日記と同じ。src/lib/attachments.ts)。
  const initialId = initial?.id;
  useEffect(() => {
    if (!initialId) return;
    let alive = true;
    loadAttachmentDrafts("tripSchedule", initialId).then((drafts) => {
      if (alive) setPhotos(drafts);
    });
    return () => {
      alive = false;
    };
  }, [initialId]);

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
      transportMode: type === "transport" && transportMode ? transportMode : undefined,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    // 新しい予定にはまだ id が無く、写真の貼り先を決められない。保存して得た id に向けて、あとで写真を書く。
    let scheduleId: string;
    if (initial?.id) {
      scheduleId = initial.id;
      await db.tripSchedule.update(initial.id, record);
    } else {
      scheduleId = String(await db.tripSchedule.add(record));
    }
    await saveAttachmentDrafts("tripSchedule", scheduleId, photos);
    setSaving(false);
    onSaved(date);
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
        {type === "transport" && (
          <SegmentedField
            label="移動手段"
            optional
            value={transportMode}
            options={TRANSPORT_OPTIONS}
            onChange={setTransportMode}
            columns={5}
            stacked
          />
        )}
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

      <FormPanel caption="写真" icon={ImagePlus}>
        <PhotoField value={photos} onChange={setPhotos} />
        <p className="text-xs text-slate-400">写真は、この端末の中にだけ保存されます(ほかの端末・共有したしおりには出ません)。</p>
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
