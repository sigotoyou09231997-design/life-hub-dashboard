import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import { Card } from "../ui/Card";
import { Pin, ChevronRight } from "lucide-react";

export function RecentNotesCard() {
  const notes = useLiveQuery(() => db.notes.toArray(), []);
  const sorted = [...(notes ?? [])].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  return (
    <Link to="/records/notes">
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-600">最近のメモ</p>
          <ChevronRight size={18} className="text-slate-300" />
        </div>
        {sorted.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">メモがありません</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {sorted.slice(0, 3).map((n) => (
              <div key={n.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                {n.pinned && <Pin size={12} className="shrink-0 text-accent" />}
                <span className="truncate">{n.title}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Link>
  );
}
