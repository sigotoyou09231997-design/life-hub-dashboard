import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { useSwipeAction, type SwipeAction } from "../../hooks/useSwipeAction";
import type { SwipeSide } from "../../lib/gestures";

export type { SwipeAction } from "../../hooks/useSwipeAction";

interface Props {
  /** 左へ払った時の操作(例: 明日へ・削除・既読)。 */
  left?: SwipeAction;
  /** 右へ払った時の操作(例: 完了)。 */
  right?: SwipeAction;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

/** 払っている間に行の下に見える色と文字。右へ払うと左端に、左へ払うと右端に出る。 */
function SwipeUnderlay({ side, action }: { side: SwipeSide; action: SwipeAction }) {
  const Icon = action.icon;
  return (
    <div className={`swipe-row__under swipe-row__under--${side} swipe-row__under--${action.tone}`} aria-hidden="true">
      <Icon size={18} strokeWidth={2.2} className="swipe-row__icon" />
      <span>{action.label}</span>
    </div>
  );
}

/**
 * 指で横へ払える行(UI/UX 調査メモ 第4弾 A-3)。中身(ListRow など)を包むだけで、中身の見た目は変えない。
 * 指の追い方は src/hooks/useSwipeAction.ts、見た目は src/styles/gestures.css。
 *
 * 払える向きの無い行(left も right も無い・disabled)では何もしない — 行の触り心地は今までどおり。
 */
export function SwipeRow({ left, right, disabled, className, children }: Props) {
  const swipe = useSwipeAction({ left, right, disabled });
  const shown = swipe.side === "left" ? left : swipe.side === "right" ? right : undefined;

  return (
    <div
      ref={swipe.rootRef}
      className={twMerge("swipe-row", swipe.enabled && "swipe-row--enabled", className)}
      data-swipe-state={swipe.state}
      data-swipe-side={swipe.side ?? undefined}
      data-swipe-armed={swipe.armed ? "true" : undefined}
      {...swipe.bind}
    >
      {/* 下の色は、払っている間だけ置く(長い一覧で、行ごとに隠れた要素を抱えないように)。 */}
      {swipe.state !== "idle" && shown && swipe.side && <SwipeUnderlay side={swipe.side} action={shown} />}
      <div ref={swipe.surfaceRef} className="swipe-row__surface">
        {children}
      </div>
    </div>
  );
}
