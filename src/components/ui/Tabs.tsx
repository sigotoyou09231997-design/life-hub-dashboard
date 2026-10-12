import { useEffect, useRef } from "react";

export interface TabOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * 中身の長さが決まらないタブ（Gmailのアカウント＝メールアドレス、CSV取り込みの
   * 「1列(符号で判定)」など）だけ、文字を小さくする。**大きさ（高さ・余白）は
   * 変えない** — 画面ごとにタブの見た目が違って見える原因がここだったので、
   * 逃がしてよいのは文字の大きさだけにしてある（2026-09-05の依頼）。
   */
  dense?: boolean;
  className?: string;
}

/**
 * 画面やシートの中身を切り替えるタブ。**大きさは1種類しかない。**
 *
 * 2026-09-05まで dense(min-h-9 + 11px) / 既定(min-h-9 + 14px) / large(min-h-12 + 14px)
 * の3つがあり、どれを使うかが画面ごとに揃っていなかった（お金管理は dense、
 * メモ・リストは既定、旅行詳細は large）。同じ「タブ切り替え」が画面ごとに違って
 * 見えるので、大きさは large だった形に一本化した。
 *
 * 2026-09-06に「ボタンはそれぞれ分けて表示がいい」（本人）で、**1つの入れ物に
 * 詰めて白いつまみを滑らせる形をやめた**。いまは1つずつ独立した丸ボタンを隙間を空けて並べる。
 *
 * 2026-10-12(UI/UX 調査メモ C-2): 6個のタブを3列×2段に折り返すのをやめ、**1段のまま横に
 * スクロールする**形にした。2段だと画面の上を大きく使い、4個の予定・タスクでも狭い幅では
 * 右端の「就活」が切れていた。入りきる時は今までどおり幅いっぱいに均等に広がり、入りきらない
 * 時だけ横に流せる。選んだタブは帯の真ん中へ寄せる(端のタブを選んでも隠れないように)。
 */
export function Tabs<T extends string>({ options, value, onChange, dense = false, className = "" }: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const placedOnce = useRef(false);

  // 入りきらない時は、隠れている側の端を薄くして「まだ続きがある」と分かるようにする
  // (CSS の [data-more-left] / [data-more-right])。描き直しを起こさないよう属性で持つ。
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const mark = () => {
      const max = list.scrollWidth - list.clientWidth;
      list.dataset.moreLeft = String(max > 1 && list.scrollLeft > 1);
      list.dataset.moreRight = String(max > 1 && list.scrollLeft < max - 1);
    };
    mark();
    list.addEventListener("scroll", mark, { passive: true });
    window.addEventListener("resize", mark);
    return () => {
      list.removeEventListener("scroll", mark);
      window.removeEventListener("resize", mark);
    };
  }, [options.length]);

  useEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !selected) return;
    // 入りきっている時は動かさない(スクロールする余地が無い)。
    if (list.scrollWidth <= list.clientWidth) return;
    const left = selected.offsetLeft - (list.clientWidth - selected.offsetWidth) / 2;
    // scrollIntoView は画面ごと縦にも動かしてしまうので、帯の中だけを動かす。
    list.scrollTo?.({ left: Math.max(0, left), behavior: placedOnce.current ? "smooth" : "auto" });
    placedOnce.current = true;
  }, [value]);

  // className(mb-4 など、置き場所の余白)は外側の箱に付ける。内側の帯は影を切らないための
  // 負の余白を持っているので、そこに付けると打ち消されてしまう(layout-teal.css)。
  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        className="spatial-tabs spatial-tabs--scroll relative flex gap-2 overflow-x-auto"
      >
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(opt.value)}
              className={`spatial-tabs__tab min-h-12 flex-[1_0_auto] whitespace-nowrap border px-4 py-3 font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${
                dense ? "text-[11px]" : "text-sm"
              } ${
                selected
                  ? "is-selected border-white/50 bg-white/55 font-semibold text-accent"
                  : "border-white/35 bg-white/18 text-slate-500 hover:text-slate-700"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
