import type { FixedCost } from "../../types";
import { CreditCard, Trash2 } from "lucide-react";
import { Badge } from "../ui/Badge";
import { ListRow } from "../ui/ListRow";
import { EmptyState } from "../ui/EmptyState";

interface Props {
  fixedCosts: FixedCost[];
  onEdit: (f: FixedCost) => void;
  onDelete: (id: string) => void;
}

export function FixedCostList({ fixedCosts, onEdit, onDelete }: Props) {
  if (fixedCosts.length === 0) {
    return (
      <EmptyState icon={CreditCard} title="固定費がまだ登録されていません" description="下のボタンから登録できます。" />
    );
  }

  return (
    <div className="space-y-2">
      {fixedCosts.map((f) => (
        <ListRow key={f.id} interactive className="p-0">
          <button
            type="button"
            onClick={() => onEdit(f)}
            aria-label={`${f.title}を編集`}
            className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          />
          <div className="pointer-events-none relative z-10 flex items-center justify-between gap-3 p-3.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="line-clamp-2 text-sm font-medium text-slate-900" title={f.title}>
                  {f.title}
                </span>
                {!f.active && <Badge tone="neutral">停止中</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                {f.category} ・ 毎月{f.dueDay}日
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-sm font-semibold text-slate-900">¥{f.amount.toLocaleString()}</span>
              <button
                type="button"
                onClick={() => {
                  if (f.id && confirm(`「${f.title}」を削除しますか?`)) onDelete(f.id);
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
  );
}
