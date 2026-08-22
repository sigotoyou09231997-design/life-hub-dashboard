import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { DiaryEntry, Mood } from "../../types";
import { todayStr } from "../../lib/date";
import { Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { useObjectUrls } from "../../hooks/useObjectUrls";
import { formatDisplayDate } from "../../lib/date";
import { ImagePlus, X } from "lucide-react";

interface Props {
  initial?: DiaryEntry;
  onSaved: () => void;
  onCancel: () => void;
}

const MOODS: { value: Mood; emoji: string; label: string }[] = [
  { value: "great", emoji: "😄", label: "最高" },
  { value: "good", emoji: "🙂", label: "良い" },
  { value: "okay", emoji: "😐", label: "普通" },
  { value: "bad", emoji: "🙁", label: "微妙" },
  { value: "terrible", emoji: "😞", label: "最悪" },
];

export function DiaryForm({ initial, onSaved, onCancel }: Props) {
  const [date] = useState(initial?.date ?? todayStr());
  const [content, setContent] = useState(initial?.content ?? "");
  const [mood, setMood] = useState<Mood>(initial?.mood ?? "okay");
  const [satisfaction, setSatisfaction] = useState(initial?.satisfaction ?? 3);
  const [photos, setPhotos] = useState<Blob[]>(initial?.photos ?? []);
  const [saving, setSaving] = useState(false);
  const photoUrls = useObjectUrls(photos);

  const todaySummary = useLiveQuery(async () => {
    if (date !== todayStr()) return null;
    const [transactions, events, tasks] = await Promise.all([
      db.transactions.where("date").equals(date).toArray(),
      db.calendarEvents.where("date").equals(date).toArray(),
      db.tasks.toArray(),
    ]);
    const spentToday = transactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + t.amount, 0);
    const completedToday = tasks.filter(
      (t) => t.completed && t.completedAt && new Date(t.completedAt).toISOString().slice(0, 10) === date,
    );
    return { spentToday, eventCount: events.length, completedCount: completedToday.length };
  }, [date]);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    setPhotos((prev) => [...prev, ...Array.from(files)]);
    e.target.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const record: DiaryEntry = {
      date,
      content,
      photos,
      mood,
      satisfaction,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (initial?.id) {
      await db.diaryEntries.put({ ...record, id: initial.id });
    } else {
      const existing = await db.diaryEntries.where("date").equals(date).first();
      if (existing?.id) {
        await db.diaryEntries.put({ ...record, id: existing.id });
      } else {
        await db.diaryEntries.add(record);
      }
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {todaySummary && (
        <div className="diary-today">
          <span>{formatDisplayDate(date)}</span>
          <div>
            <div>
              <small>使った額</small>
              <strong>¥{todaySummary.spentToday.toLocaleString("ja-JP")}</strong>
            </div>
            <div>
              <small>予定</small>
              <strong>{todaySummary.eventCount}件</strong>
            </div>
            <div>
              <small>終えたタスク</small>
              <strong>{todaySummary.completedCount}件</strong>
            </div>
          </div>
        </div>
      )}

      <FormPanel caption="今日はどうだった">
        <Field label="気分" as="div">
          <div className="mood-grid">
            {MOODS.map((m) => (
              <button
                type="button"
                key={m.value}
                onClick={() => setMood(m.value)}
                aria-pressed={mood === m.value}
                aria-label={m.label}
                className="mood-grid__option"
              >
                <span>{m.emoji}</span>
                <small>{m.label}</small>
              </button>
            ))}
          </div>
        </Field>

        <Field label="満足度" as="div">
          <div className="rating-row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                type="button"
                key={n}
                onClick={() => setSatisfaction(n)}
                aria-pressed={satisfaction >= n}
                aria-label={`満足度 ${n}`}
                className="rating-row__step"
              >
                {n}
              </button>
            ))}
          </div>
        </Field>
      </FormPanel>

      <FormPanel caption="書きとめる">
        <Textarea
          label="今日の出来事"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          placeholder="今日あったことを書いてみましょう"
        />

        <Field label="写真" optional as="div">
          {photoUrls.length > 0 && (
            <div className="photo-grid">
              {photoUrls.map((url, i) => (
                <div key={url} className="photo-grid__item">
                  <img src={url} alt="" />
                  <button
                    type="button"
                    onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label="写真を削除"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* OSごとに見た目が変わる素のファイル選択は隠し、この app のボタンで包む。 */}
          <label className="photo-add">
            <ImagePlus size={16} />
            写真を追加
            <input type="file" accept="image/*" multiple onChange={handlePhotoChange} />
          </label>
        </Field>
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "日記を保存"}
        </Button>
      </FormActions>
    </form>
  );
}
