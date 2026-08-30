import type { CSSProperties } from "react";

/**
 * Fixed per-area accent colors, matching TOP's card identity colors exactly
 * (see TopPage.tsx's ACCENT_STYLES). Applied by overriding --color-accent /
 * --color-accent-light on each area's root element so every Tailwind
 * `accent`-family class (bg-accent, text-accent, ring-accent, ...) used by
 * nested components picks it up automatically — no per-component edits needed.
 * This intentionally overrides the user's Settings accent-color choice within
 * these areas so the four sections stay visually consistent with their TOP card.
 */
/**
 * 値は暖色・写真ベースの新デザインの機能別の色（src/styles/theme-warm.css の
 * --tone-* ）と1対1で揃えてある。CSS変数を参照せず数値を書いているのは、これを
 * インラインstyleで各画面の根っこに置くため（style属性の中では var() が
 * 使えるが、Reactのstyleオブジェクトからは他所の :root 定義に依存させない方が
 * 追いやすい）。片方だけ直すと必ず食い違うので、変えるときは両方を直すこと。
 *
 * 2026-08-31: お金管理とメモの色が、下部ナビ（新デザインの指定＝お金管理は紫・
 * メモは橙）と逆になっていた。ナビのアイコンは紫なのに、開いた先のボタンや
 * タブは橙、という食い違いになっていたので --tone-* に合わせて入れ替えた。
 */
export const AREA_ACCENT_STYLE: Record<"money" | "schedule" | "notes" | "trips" | "gmail", CSSProperties> = {
  money: { "--color-accent": "#7b71c0", "--color-accent-light": "rgba(241, 239, 251, .8)" } as CSSProperties,
  schedule: { "--color-accent": "#5e8bbc", "--color-accent-light": "rgba(233, 240, 248, .8)" } as CSSProperties,
  notes: { "--color-accent": "#d08a55", "--color-accent-light": "rgba(251, 241, 232, .8)" } as CSSProperties,
  trips: { "--color-accent": "#4e9e9b", "--color-accent-light": "rgba(232, 245, 244, .8)" } as CSSProperties,
  // Gmailだけ、この指定が無いまま既定の青を使っていたので、ナビのGmailだけ
  // アイコンが赤・ページの中身が青、という食い違いになっていた。
  gmail: { "--color-accent": "#dc6355", "--color-accent-light": "rgba(253, 238, 236, .8)" } as CSSProperties,
};
