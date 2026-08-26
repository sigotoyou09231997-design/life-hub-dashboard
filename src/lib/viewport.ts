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

/** キーボード(やiOSの選択ホイール)が開くのは、文字を入れる部品に focus がある時だけ。
 *
 * iOSは、キーボードを閉じた時の visualViewport の変化を知らせ損ねることがある。その時
 * 「隠れている高さ」が出たままになり、シートが画面の上の方へ浮いたまま戻らず、下側の
 * 操作ボタンが画面の外に残る(2026-08-26の不具合)。focus が文字を入れる部品に無ければ
 * キーボードは出ていないので、隠れている高さも0とみなす。 */
export function opensKeyboard(element: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!element) return false;
  if (element.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName ?? "");
}
