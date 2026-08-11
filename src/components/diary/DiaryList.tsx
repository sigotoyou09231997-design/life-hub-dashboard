import { BookHeart } from "lucide-react";
import type { DiaryEntry } from "../../types";
import { DiaryEntryCard } from "./DiaryEntryCard";
import { EmptyState } from "../ui/EmptyState";

interface Props {
  entries: DiaryEntry[];
  onEdit: (entry: DiaryEntry) => void;
  onDelete: (id: string) => void;
}

export function DiaryList({ entries, onEdit, onDelete }: Props) {
  if (entries.length === 0) {
    return (
      <EmptyState icon={BookHeart} title="日記がまだありません" description="下のボタンから今日の日記を書けます。" />
    );
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
