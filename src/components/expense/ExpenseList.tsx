import type { Transaction } from "../../types";
import { formatDisplayDate } from "../../lib/date";
import { Badge } from "../ui/Badge";
import { ListRow } from "../ui/ListRow";
import { EmptyState } from "../ui/EmptyState";
import { Receipt, Trash2 } from "lucide-react";

interface Props {
  transactions: Transaction[];
  onEdit: (t: Transaction) => void;
  onDelete: (id: string) => void;
}

export function ExpenseList({ transactions, onEdit, onDelete }: Props) {
  if (transactions.length === 0) {
    return (
      <EmptyState icon={Receipt} title="今月の記録がまだありません" description="下のボタンから収支を追加できます。" />
    );
  }

  const byDate = new Map<string, Transaction[]>();
  for (const t of [...transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date)!.push(t);
  }

  return (
    <div className="space-y-5">
      {[...byDate.entries()].map(([date, items]) => (
        <div key={date}>
          <p className="mb-2 text-xs font-medium text-slate-400">{formatDisplayDate(date)}</p>
          <div className="space-y-2">
            {items.map((t) => (
              <ListRow key={t.id} interactive className="p-0">
                <button
                  type="button"
                  onClick={() => onEdit(t)}
                  aria-label={`${t.category}を編集`}
                  className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                />
                <div className="pointer-events-none relative z-10 flex items-center justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">{t.category}</span>
                      {t.isFixed && <Badge tone="neutral">固定費</Badge>}
                    </div>
                    {(t.store || t.memo) && (
                      <p className="mt-0.5 truncate text-xs text-slate-400">{t.store || t.memo}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`text-sm font-semibold ${
                        t.type === "income" ? "text-success" : "text-slate-900"
                      }`}
                    >
                      {t.type === "income" ? "+" : "-"}¥{t.amount.toLocaleString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (t.id && confirm(`「${t.category}」(¥${t.amount.toLocaleString()})を削除しますか?`)) {
                          onDelete(t.id);
                        }
                      }}
                      aria-label="削除"
                      className="pointer-events-auto rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </ListRow>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
