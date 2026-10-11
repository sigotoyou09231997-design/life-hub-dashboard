import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { db } from "../../db/schema";
import type { TripPackingCategory, TripPackingItem } from "../../types";
import { TRIP_PACKING_CATEGORIES } from "../../lib/tripCategories";
import { moveTo, renumberPacking, sortPacking } from "../../lib/packingOrder";
import { Card } from "../ui/Card";
import { ListRow } from "../ui/ListRow";
import { EmptyState } from "../ui/EmptyState";
import { useConfirm } from "../ui/ConfirmProvider";
import { Check, GripVertical, Package, Trash2 } from "lucide-react";

interface Props {
  items: TripPackingItem[];
  onEdit: (item: TripPackingItem) => void;
  onDelete: (id: string) => void;
}

/** 長押しと見なすまでの時間。これより前に指が動いたら、並べ替えではなく普通のスクロール。 */
export const LONG_PRESS_MS = 350;
const MOVE_TOLERANCE_PX = 8;

interface Drag {
  category: TripPackingCategory;
  pointerId: number;
  from: number;
  over: number;
}

/**
 * 持ち物の一覧。種類ごとに並べ、種類の中は長押しして指で上下に動かすと並べ替えられる
 * (2026-10-11、要望の受信箱「持ち物の順番を長押しスワイプで入れ替えられるようにして」)。
 *
 * 長押しの前に指が動いたら普通のスクロールとして扱う。並べ替えている間だけ、画面のスクロールを止める
 * (止めないと、iOS はスクロールを始めて指の動きを横取りし、並べ替えが途中で切れる)。
 */
export function TripPackingList({ items, onEdit, onDelete }: Props) {
  const confirm = useConfirm();
  const checkedCount = items.filter((i) => i.checked).length;
  const uncheckedCount = items.length - checkedCount;

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** 並べ替えを終えた直後の「押した」(指を離した時に出るクリック)で、編集を開かないための印。 */
  const justDraggedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 並べ替えている間は、指の動きでページがスクロールしないようにする(passive: false で止める)。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const stop = (event: TouchEvent) => {
      if (dragRef.current) event.preventDefault();
    };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, []);

  useEffect(() => () => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
  }, []);

  function cancelPress() {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>, category: TripPackingCategory, index: number) {
    // 右クリックなど、主のボタン以外は並べ替えに使わない。
    if (event.button > 0) return;
    cancelPress();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const timer = window.setTimeout(() => {
      pressRef.current = null;
      // 指が行の外へ出ても動きを追えるように捕まえる。捕まえられなくても(古い端末など)並べ替えは続ける —
      // 指が離れていたら、その時点で上の待ちが取り消されているので、ここには来ない。
      try {
        target.setPointerCapture?.(pointerId);
      } catch {
        // 何もしない
      }
      navigator.vibrate?.(15);
      setDrag({ category, pointerId, from: index, over: index });
    }, LONG_PRESS_MS);
    pressRef.current = { timer, x: event.clientX, y: event.clientY };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const press = pressRef.current;
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE_PX) {
      cancelPress();
      return;
    }
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const rows = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>(`[data-pack-category="${current.category}"] [data-pack-row]`) ?? [],
    );
    // 指の高さより上に真ん中がある行の数が、落とす位置(動かしている行そのものは数えない)。
    let over = 0;
    rows.forEach((row) => {
      if (row.dataset.dragging === "true") return;
      const rect = row.getBoundingClientRect();
      if (event.clientY > rect.top + rect.height / 2) over += 1;
    });
    if (over !== current.over) setDrag({ ...current, over });
  }

  async function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>, catItems: TripPackingItem[]) {
    cancelPress();
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setDrag(null);
    justDraggedRef.current = true;
    window.setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);
    if (current.from === current.over) return;
    const changes = renumberPacking(moveTo(catItems, current.from, current.over));
    await Promise.all(changes.map((change) => db.tripPackingItems.update(change.id, { sortOrder: change.sortOrder })));
  }

  function handlePointerCancel() {
    cancelPress();
    setDrag(null);
  }

  return (
    <div className="space-y-4" ref={containerRef}>
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
            const dragging = drag?.category === cat.value ? drag : null;
            // 並べ替えている最中は、落とす位置に動かした並びで見せる(指を離す前に、どこに入るか分かるように)。
            const shown = dragging ? moveTo(catItems, dragging.from, dragging.over) : catItems;
            return (
              <div key={cat.value} data-pack-category={cat.value}>
                <p className="label-on-photo mb-2 text-sm font-medium text-slate-600">{cat.label}</p>
                <div className="space-y-2">
                  {shown.map((item) => {
                    const index = catItems.indexOf(item);
                    const isDragged = dragging !== null && catItems[dragging.from] === item;
                    return (
                      <ListRow
                        key={item.id}
                        data-pack-row
                        data-dragging={isDragged ? "true" : undefined}
                        onPointerDown={(event) => handlePointerDown(event, cat.value, index)}
                        onPointerMove={handlePointerMove}
                        onPointerUp={(event) => void handlePointerUp(event, catItems)}
                        onPointerCancel={handlePointerCancel}
                        onClickCapture={(event) => {
                          if (justDraggedRef.current) {
                            event.preventDefault();
                            event.stopPropagation();
                          }
                        }}
                        onContextMenu={(event) => event.preventDefault()}
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
                          onClick={async () => {
                            if (item.id && (await confirm({ title: `「${item.title}」を削除しますか?` }))) {
                              onDelete(item.id);
                            }
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
