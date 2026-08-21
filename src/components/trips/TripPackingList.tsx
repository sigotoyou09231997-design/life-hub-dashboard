import { db } from "../../db/schema";
import type { TripPackingItem } from "../../types";
import { TRIP_PACKING_CATEGORIES } from "../../lib/tripCategories";
import { Card } from "../ui/Card";
import { ListRow } from "../ui/ListRow";
import { EmptyState } from "../ui/EmptyState";
import { Check, Package, Trash2 } from "lucide-react";

interface Props {
  items: TripPackingItem[];
  onEdit: (item: TripPackingItem) => void;
  onDelete: (id: string) => void;
}

export function TripPackingList({ items, onEdit, onDelete }: Props) {
  const checkedCount = items.filter((i) => i.checked).length;
  const uncheckedCount = items.length - checkedCount;

  return (
    <div className="space-y-4">
      <Card className="flex justify-between text-sm">
        <div>
          <p className="text-slate-400">準備済み</p>
          <p className="mt-0.5 font-semibold text-success">{checkedCount}件</p>
        </div>
        <div className="text-right">
          <p className="text-slate-400">未準備</p>
          <p className="mt-0.5 font-semibold text-slate-900">{uncheckedCount}件</p>
        </div>
      </Card>

      {items.length === 0 ? (
        <EmptyState icon={Package} title="持ち物がまだ登録されていません" description="下のボタンから追加できます。" />
      ) : (
        TRIP_PACKING_CATEGORIES.map((cat) => {
          const catItems = items.filter((i) => i.category === cat.value);
          if (catItems.length === 0) return null;
          return (
            <div key={cat.value}>
              <p className="label-on-photo mb-2 text-sm font-medium text-slate-600">{cat.label}</p>
              <div className="space-y-2">
                {catItems.map((item) => (
                  <ListRow key={item.id} className="flex items-center gap-3">
                    <button
                      onClick={() => item.id && db.tripPackingItems.update(item.id, { checked: !item.checked })}
                      aria-label="準備済みを切り替え"
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        item.checked ? "border-success bg-success text-white" : "border-slate-300"
                      }`}
                    >
                      {item.checked && <Check size={14} strokeWidth={3} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(item)}
                      aria-label={`持ち物「${item.title}」を編集`}
                      title={item.title}
                      className={`line-clamp-2 min-w-0 flex-1 rounded-lg text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                        item.checked ? "text-slate-400 line-through" : "text-slate-900"
                      }`}
                    >
                      {item.title}
                    </button>
                    <button
                      onClick={() => item.id && confirm(`「${item.title}」を削除しますか?`) && onDelete(item.id)}
                      aria-label="削除"
                      className="shrink-0 rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </ListRow>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
