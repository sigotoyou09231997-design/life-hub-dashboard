import { forwardRef } from "react";
import { ArrowDown, RefreshCw } from "lucide-react";
import type { PullPhase } from "../../hooks/usePullToRefresh";

/**
 * 「引っ張って更新」の目印(UI/UX 調査メモ 第4弾 A-7)。画面の一番上から、引いた分だけ下りてくる丸。
 * 位置は usePullToRefresh が style(--pull・--pull-progress)へ直接書く。見た目は src/styles/gestures.css。
 *
 * ページそのものは動かさない(.page-transition などを transform で動かすと、その中の position: fixed の
 * シートの基準がずれる — index.css の .page-transition の注意書きと同じ理由)。
 */
export const PullToRefreshIndicator = forwardRef<HTMLDivElement, { phase: PullPhase }>(function PullToRefreshIndicator(
  { phase },
  ref,
) {
  return (
    <div ref={ref} className="pull-indicator" data-phase={phase} aria-hidden="true">
      {phase === "refreshing" ? <RefreshCw size={18} strokeWidth={2.2} /> : <ArrowDown size={18} strokeWidth={2.2} />}
    </div>
  );
});
