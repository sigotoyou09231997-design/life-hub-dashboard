/**
 * ソフトキーボードで隠れている高さ(px)。
 *
 * iOS(特にホーム画面から開いたPWA)は、キーボードが出てもレイアウト上の画面の高さ
 * (window.innerHeight)を変えない。そのため画面下に張り付く入力シートは、下半分が
 * キーボードの裏に潜ったままになり、入力欄を見るのに毎回自分でスクロールする必要が
 * あった。実際に見えている領域(visualViewport)との差を取れば、その隠れている高さが
 * 分かるので、その分だけシートを持ち上げられる。
 *
 * offsetTop を足しているのは、iOSがキーボードを出す時に見えている領域自体を上へ
 * ずらすことがあるため(そのぶんも下に隠れている)。
 *
 * 小さい差はツールバーの出入りなどで常時発生するので、しきい値未満は 0 とみなす —
 * キーボードが出ていないのにシートが数十px浮くのを避ける。
 */
export const KEYBOARD_INSET_THRESHOLD_PX = 60;

export function keyboardInsetFrom(layoutHeight: number, visualHeight: number, visualOffsetTop: number): number {
  const hidden = layoutHeight - (visualHeight + visualOffsetTop);
  if (!Number.isFinite(hidden) || hidden < KEYBOARD_INSET_THRESHOLD_PX) return 0;
  return Math.round(hidden);
}
