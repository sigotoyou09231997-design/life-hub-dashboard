import type { DiaryEntry } from "../../types";
import { DiaryEntryCard } from "./DiaryEntryCard";

interface Props {
  entries: DiaryEntry[];
  onEdit: (entry: DiaryEntry) => void;
  onDelete: (id: number) => void;
}

export function DiaryList({ entries, onEdit, onDelete }: Props) {
  if (entries.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">日記がまだありません</p>;
  }

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-2">
      {sorted.map((entry) => (
        <DiaryEntryCard key={entry.id} entry={entry} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}
