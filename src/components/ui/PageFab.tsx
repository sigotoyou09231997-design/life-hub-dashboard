import { type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  onClick: () => void;
  /** 読み上げ用の名前(画面には出ない)。例:「旅行を追加」 */
  label: string;
  children: ReactNode;
}

/**
 * 画面の右下に置く丸ボタン(追加・作成)。位置と大きさは全ページで同じ。
 *
 * ページの中ではなく、App側に用意した専用の置き場(#page-fab-root)へ出す。
 * ページ切り替えのアニメーション(.page-transition)はtransformで動くため、
 * その中にposition:fixedのボタンを置くと「固定」の基準がビューポートではなく
 * アニメーション中のその箱になり、切り替えのたびにボタンが右下へ滑り込んで
 * 見えていた。外に出すと基準がビューポートに戻り、最初から右下に居たまま動かない。
 *
 * body直下ではなく.app-shellの中に出しているのは、あそこがisolation:isolateで
 * 重なりの階層を作っているため — body直下に出すと、開いているシート(z-50)より
 * このボタン(z-40)が上に来てしまう。
 *
 * transform-gpu は下のタブバー(QuickActionBar)と同じ対策。iOSは速いスクロールの
 * 最中、position:fixed の要素をビューポートに留められないことがあり、指を動かして
 * いる間だけボタンがスクロールに引きずられて浮いて見える。あらかじめ合成レイヤーを
 * 分けておくと、スクロールする中身とは別に動かせるのでずれない。
 * (この要素の中にfixedの子は無いので、transformが基準になって困ることもない)
 */
export function PageFab({ onClick, label, children }: Props) {
  const host = typeof document === "undefined" ? null : document.getElementById("page-fab-root");
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem-var(--viewport-gap,0px))] right-5 z-40 flex h-14 w-14 transform-gpu items-center justify-center rounded-full bg-accent text-white shadow-[0_10px_28px_rgba(79,111,255,0.35)] transition-all active:translate-y-px active:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 lg:bottom-8 lg:right-8"
    >
      {children}
    </button>
  );
  // 置き場が無い場合(テストでページ単体を描いた時など)は、その場に出す。
  return host ? createPortal(button, host) : button;
}
