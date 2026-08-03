import type { DiaryEntry, Mood } from "../../types";
import { formatDisplayDate } from "../../lib/date";
import { useObjectUrls } from "../../hooks/useObjectUrls";
import { Trash2 } from "lucide-react";

const MOOD_EMOJI: Record<Mood, string> = {
  great: "😄",
  good: "🙂",
  okay: "😐",
  bad: "🙁",
  terrible: "😞",
};

interface Props {
  entry: DiaryEntry;
  onEdit: (entry: DiaryEntry) => void;
  onDelete: (id: number) => void;
}

export function DiaryEntryCard({ entry, onEdit, onDelete }: Props) {
  const photoUrls = useObjectUrls(entry.photos);

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3.5" onClick={() => onEdit(entry)}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{MOOD_EMOJI[entry.mood]}</span>
          <div>
            <p className="text-sm font-medium text-slate-900">{formatDisplayDate(entry.date)}</p>
            <p className="text-xs text-slate-400">満足度 {entry.satisfaction}/5</p>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (entry.id) onDelete(entry.id);
          }}
          className="rounded-full p-1.5 text-slate-300 active:bg-red-50 active:text-danger"
        >
          <Trash2 size={16} />
        </button>
      </div>
      {entry.content && <p className="mt-2 line-clamp-3 text-sm text-slate-600">{entry.content}</p>}
      {photoUrls.length > 0 && (
        <div className="mt-2 flex gap-1.5">
          {photoUrls.slice(0, 4).map((url) => (
            <img key={url} src={url} className="h-14 w-14 rounded-lg object-cover" alt="" />
          ))}
        </div>
      )}
    </div>
  );
}
