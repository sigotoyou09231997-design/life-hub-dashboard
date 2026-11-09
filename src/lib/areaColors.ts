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
/**
 * 2026-10-12: 白＋青緑の上塗り（src/styles/theme-teal.css）で、ボタン・タブなどの
 * アクセントは全画面で青緑1色にまとめた（参考にしたアプリに合わせて）。機能ごとの色
 * （--tone-*）は予定のカテゴリなど「データの色」として残っているので、そちらは変えない。
 * 元の機能別の値は git の履歴（この行の1つ前）にある。
 */
/**
 * 2026-11-09: 深い青緑 #1b5e57 へ(src/styles/theme-ref.css の --ref-700 と同じ値。変えるときは両方を直すこと)。
 * ここがインラインで #17a199 のままだったので、各画面の中の主役のボタン(bg-accent)だけが前の明るい青緑で残っていた。
 */
const TEAL_ACCENT = { "--color-accent": "#1b5e57", "--color-accent-light": "rgba(238, 246, 244, .9)" } as CSSProperties;

export const AREA_ACCENT_STYLE: Record<"money" | "schedule" | "notes" | "trips" | "gmail", CSSProperties> = {
  money: TEAL_ACCENT,
  schedule: TEAL_ACCENT,
  notes: TEAL_ACCENT,
  trips: TEAL_ACCENT,
  gmail: TEAL_ACCENT,
};
