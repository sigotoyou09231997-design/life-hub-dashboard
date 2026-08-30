/**
 * アプリの一番下に敷く地。
 *
 * 以前は時間帯ごとに実写の背景写真を全画面に敷き、その上に半透明のガラス面を
 * 重ねていた（リキッドグラス）。2026-08-30 の全面刷新で、地は生成りのクリーム
 * 一色になり、写真は「地」ではなくカードの中で使うものになったので、ここは
 * 色を敷くだけの役目になっている（実際の色は src/styles/theme-warm.css）。
 *
 * 写真そのものは無くなっていない — 旅行の表紙とホームのヒーローが
 * src/lib/backgrounds.ts の同じ素材を使い続けている。
 */
export function AmbientBackground() {
  return <div className="ambient-background" aria-hidden="true" />;
}
