import { useEffect, useState } from "react";

/**
 * 読み込み中に出す「これから出る画面の形」の薄い下書き(スケルトン)。2026-11-09。
 * 参考: @bzagrodzki「Your users deserve a loading state」— 読み込み中がくるくる1つだけだと、
 * 待っているのか止まっているのか分からない。LIFE HUB では、ページを切り替えた時は小さな「読み込み中…」の札、
 * 起動の待ちは真っ白(本人「真っ白から動かない」の見た目と同じ)だった。
 *
 * 見出し・タブ・カード2枚の形を薄い灰色で置き、ゆっくり明滅させる(動きを減らす設定では止める。theme-ref.css)。
 * すぐ読み終わる時にちらつかないよう、delayMs たつまでは何も出さない。
 */
export function PageSkeleton({ delayMs = 400, label = "読み込み中" }: { delayMs?: number; label?: string }) {
  const [shown, setShown] = useState(delayMs <= 0);
  useEffect(() => {
    if (delayMs <= 0) return;
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);
  if (!shown) return <div className="page-skeleton" aria-hidden="true" />;
  return (
    <div className="page-skeleton is-shown" role="status" aria-live="polite" aria-label={label}>
      <div className="page-skeleton__title" />
      <div className="page-skeleton__sub" />
      <div className="page-skeleton__tabs">
        <span />
        <span />
        <span />
      </div>
      <div className="page-skeleton__card page-skeleton__card--tall" />
      <div className="page-skeleton__card" />
    </div>
  );
}
