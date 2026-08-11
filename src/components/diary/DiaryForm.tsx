import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { DiaryEntry, Mood } from "../../types";
import { todayStr } from "../../lib/date";
import { Textarea } from "../ui/Input";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { useObjectUrls } from "../../hooks/useObjectUrls";
import { X } from "lucide-react";

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
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-slate-400">{date}</p>

      {todaySummary && (
        <Card className="grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <p className="text-slate-400">今日の支出</p>
            <p className="mt-1 font-semibold text-slate-900">¥{todaySummary.spentToday.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-slate-400">今日の予定</p>
            <p className="mt-1 font-semibold text-slate-900">{todaySummary.eventCount}件</p>
          </div>
          <div>
            <p className="text-slate-400">完了タスク</p>
            <p className="mt-1 font-semibold text-slate-900">{todaySummary.completedCount}件</p>
          </div>
        </Card>
      )}

      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-600">今日の気分</span>
        <div className="grid grid-cols-5 gap-1.5">
          {MOODS.map((m) => (
            <button
              type="button"
              key={m.value}
              onClick={() => setMood(m.value)}
              aria-pressed={mood === m.value}
              aria-label={m.label}
              className={`flex flex-col items-center gap-1 rounded-xl border py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                mood === m.value ? "border-accent bg-accent-light" : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <span className="text-xl">{m.emoji}</span>
              <span className={`text-[10px] ${mood === m.value ? "font-semibold text-accent" : "text-slate-500"}`}>
                {m.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-600">満足度</span>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              onClick={() => setSatisfaction(n)}
              aria-pressed={satisfaction >= n}
              aria-label={`満足度 ${n}`}
              className={`flex-1 rounded-xl border py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                satisfaction >= n ? "border-accent bg-accent text-white" : "border-slate-200 text-slate-400 hover:border-slate-300"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <Textarea
        label="今日の出来事"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={5}
        placeholder="今日あったことを書いてみましょう"
      />

      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-600">写真</span>
        {photoUrls.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {photoUrls.map((url, i) => (
              <div key={url} className="relative h-16 w-16 overflow-hidden rounded-lg">
                <img src={url} className="h-full w-full object-cover" alt="" />
                <button
                  type="button"
                  onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label="写真を削除"
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/50 p-0.5 text-white"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <input type="file" accept="image/*" multiple onChange={handlePhotoChange} className="text-sm" />
      </div>

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
