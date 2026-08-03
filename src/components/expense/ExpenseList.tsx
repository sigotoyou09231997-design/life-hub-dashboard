import type { Transaction } from "../../types";
import { formatDisplayDate } from "../../lib/date";
import { Badge } from "../ui/Badge";
import { Trash2 } from "lucide-react";

interface Props {
  transactions: Transaction[];
  onEdit: (t: Transaction) => void;
  onDelete: (id: number) => void;
}

export function ExpenseList({ transactions, onEdit, onDelete }: Props) {
  if (transactions.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">記録がまだありません</p>;
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
              <div
                key={t.id}
                onClick={() => onEdit(t)}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-3.5 active:bg-slate-50"
              >
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
                    onClick={(e) => {
                      e.stopPropagation();
                      if (t.id) onDelete(t.id);
                    }}
                    aria-label="削除"
                    className="rounded-full p-1.5 text-slate-300 active:bg-red-50 active:text-danger"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
