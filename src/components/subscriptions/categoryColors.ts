/**
 * 分析の円グラフの色。色は**カテゴリに付ける**(金額の順位には付けない) — 増えたり
 * 減ったりしても、同じカテゴリはいつも同じ色のまま。
 *
 * 8色は見分けやすさ(色覚の違いを含む)を確かめ済みの並び(dataviz の既定パレット)。
 * 8つに入らないカテゴリ(家賃・保険など、サブスクより固定費寄りのもの)は灰色の
 * 「その他」にまとめて1切れにする。一覧の行ではカテゴリごとに金額を出すので、
 * 色だけで見分ける必要は無い。
 */
export const CATEGORY_COLORS: Record<string, string> = {
  動画: "#2a78d6",
  音楽: "#eb6834",
  "AI・仕事": "#1baf7a",
  クラウド: "#eda100",
  ゲーム: "#e87ba4",
  "本・雑誌": "#008300",
  買い物: "#6250d6",
  通信費: "#e34948",
};

export const OTHER_COLOR = "#a3abaf";

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? OTHER_COLOR;
}
