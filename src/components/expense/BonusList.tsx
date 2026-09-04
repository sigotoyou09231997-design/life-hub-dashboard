import { Gift, Plus, Trash2 } from "lucide-react";
import type { Transaction } from "../../types";
import { formatDisplayDate } from "../../lib/date";
import { Card } from "../ui/Card";
import { ListRow } from "../ui/ListRow";

interface Props {
  bonuses: Transaction[];
  onAdd: () => void;
  onEdit: (bonus: Transaction) => void;
  onDelete: (id: string) => void;
}

/** 賞与の一覧。給与とは別の収入なので、給与タブの中で節を分けて置く。 */
export function BonusList({ bonuses, onAdd, onEdit, onDelete }: Props) {
  return (
    <Card className="p-4 lg:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Gift size={15} />
          賞与
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 text-xs font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <Plus size={14} />
          登録する
        </button>
      </div>

      {bonuses.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">
          賞与はまだ登録されていません。登録すると、その期の使えるお金に足されます。
        </p>
      ) : (
        <div className="space-y-2">
          {bonuses.map((bonus) => (
            <ListRow key={bonus.id} interactive className="p-0">
              <button
                type="button"
                onClick={() => onEdit(bonus)}
                aria-label={`${formatDisplayDate(bonus.date)}の賞与を編集`}
                className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              />
              <div className="pointer-events-none relative z-10 flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-slate-900">{formatDisplayDate(bonus.date)}</span>
                  {bonus.memo && <p className="mt-0.5 truncate text-xs text-slate-400">{bonus.memo}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-success">+¥{bonus.amount.toLocaleString()}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (bonus.id && confirm(`${formatDisplayDate(bonus.date)}の賞与を削除しますか?`)) {
                        onDelete(bonus.id);
                      }
                    }}
                    aria-label="削除"
                    className="pointer-events-auto rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </ListRow>
          ))}
        </div>
      )}
    </Card>
  );
}
