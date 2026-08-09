import type { SalaryEntry } from "../../types";
import { Trash2 } from "lucide-react";

interface Props {
  salaries: SalaryEntry[];
  onEdit: (s: SalaryEntry) => void;
  onDelete: (id: number) => void;
}

function formatMonth(month: string): string {
  const [year, m] = month.split("-");
  if (!year || !m) return month;
  return `${year}年${Number(m)}月`;
}

export function SalaryList({ salaries, onEdit, onDelete }: Props) {
  if (salaries.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">給与がまだ登録されていません</p>;
  }

  const sorted = [...salaries].sort((a, b) => b.month.localeCompare(a.month));

  return (
    <div className="space-y-2">
      {sorted.map((s) => (
        <div
          key={s.id}
          onClick={() => onEdit(s)}
          className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-3.5 active:bg-slate-50"
        >
          <div>
            <span className="text-sm font-medium text-slate-900">{formatMonth(s.month)}</span>
            <p className="mt-0.5 text-xs text-slate-400">給料日: 毎月{s.payday}日</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-900">¥{s.amount.toLocaleString()}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (s.id) onDelete(s.id);
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
  );
}
