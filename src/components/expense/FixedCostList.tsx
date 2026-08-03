import type { FixedCost } from "../../types";
import { Trash2 } from "lucide-react";
import { Badge } from "../ui/Badge";

interface Props {
  fixedCosts: FixedCost[];
  onEdit: (f: FixedCost) => void;
  onDelete: (id: number) => void;
}

export function FixedCostList({ fixedCosts, onEdit, onDelete }: Props) {
  if (fixedCosts.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">固定費が登録されていません</p>;
  }

  return (
    <div className="space-y-2">
      {fixedCosts.map((f) => (
        <div
          key={f.id}
          onClick={() => onEdit(f)}
          className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-3.5 active:bg-slate-50"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-900">{f.title}</span>
              {!f.active && <Badge tone="neutral">停止中</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {f.category} ・ 毎月{f.dueDay}日
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-900">¥{f.amount.toLocaleString()}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (f.id) onDelete(f.id);
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
