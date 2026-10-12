import { db } from "../../db/schema";
import type { TripPackingItem } from "../../types";
import { TRIP_PACKING_CATEGORIES } from "../../lib/tripCategories";
import { moveTo, renumberPacking, sortPacking } from "../../lib/packingOrder";
import { useLongPressReorder } from "../../hooks/useLongPressReorder";
import { Card } from "../ui/Card";
import { ListRow } from "../ui/ListRow";
import { EmptyState } from "../ui/EmptyState";
import { Check, GripVertical, Package, Trash2 } from "lucide-react";

interface Props {
  items: TripPackingItem[];
  onEdit: (item: TripPackingItem) => void;
  onDelete: (id: string) => void;
}

/**
 * 持ち物の一覧。種類ごとに並べ、種類の中は長押しして指で上下に動かすと並べ替えられる
 * (2026-10-11、要望の受信箱「持ち物の順番を長押しスワイプで入れ替えられるようにして」)。
 * 長押しの手触りは日程の並べ替えと共通(src/hooks/useLongPressReorder.ts)。
 */
export function TripPackingList({ items, onEdit, onDelete }: Props) {
  const checkedCount = items.filter((i) => i.checked).length;
  const uncheckedCount = items.length - checkedCount;

  const reorder = useLongPressReorder((category, from, to) => {
    const catItems = sortPacking(items.filter((i) => i.category === category));
    const changes = renumberPacking(moveTo(catItems, from, to));
    void Promise.all(changes.map((change) => db.tripPackingItems.update(change.id, { sortOrder: change.sortOrder })));
  });

  return (
    <div className="space-y-4" ref={reorder.containerRef}>
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
        <EmptyState icon={Package} title="持ち物がまだ登録されていません" description="下のボタンから追加できます。" card />
      ) : (
        <>
          <p className="px-1 text-xs text-slate-500">長押しして上下に動かすと、並べ替えられます。</p>
          {TRIP_PACKING_CATEGORIES.map((cat) => {
            const catItems = sortPacking(items.filter((i) => i.category === cat.value));
            if (catItems.length === 0) return null;
            // 並べ替えている最中は、落とす位置に動かした並びで見せる(指を離す前に、どこに入るか分かるように)。
            const shown = reorder.preview(cat.value, catItems);
            return (
              <div key={cat.value}>
                <p className="label-on-photo mb-2 text-sm font-medium text-slate-600">{cat.label}</p>
                <div className="space-y-2">
                  {shown.map((item) => {
                    const index = catItems.indexOf(item);
                    const isDragged = reorder.isDragging(cat.value, index);
                    return (
                      <ListRow
                        key={item.id}
                        {...reorder.rowProps(cat.value, index)}
                        className={`flex select-none items-center gap-3 [-webkit-touch-callout:none] ${
                          isDragged ? "z-10 scale-[1.02] shadow-[0_10px_24px_rgba(28,45,75,0.18)] ring-2 ring-accent/40" : ""
                        }`}
                      >
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
                        <GripVertical size={16} className="shrink-0 text-slate-300" aria-hidden="true" />
                        <button
                          // 確認は聞かない。消したあと5秒間「元に戻す」が出る(UI/UX 調査メモ 第4弾 A-2。
                          // お知らせは TripDetailPage が出す)。
                          onClick={() => {
                            if (item.id) onDelete(item.id);
                          }}
                          aria-label="削除"
                          className="shrink-0 rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                        >
                          <Trash2 size={16} />
                        </button>
                      </ListRow>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
