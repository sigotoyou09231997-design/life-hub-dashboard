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

/** レイアウト上の画面の高さが、実際に見えている高さより足りない分(px)。
 *
 * iOSは、キーボードを閉じた後に画面の高さ(window.innerHeight)を元へ戻し損ねることが
 * ある。その間 position:fixed のものは「短いままの画面」の下端に貼りつくので、下の
 * 追従ボタンもシートも画面の途中で止まって見える(2026-08-26の報告)。ページの中身は
 * その下にも描かれ続けるので、宙に浮いた帯のように見える。
 *
 * 見えている領域(visualViewport)の方が大きければ、その差だけ下へずらして辻褄を
 * 合わせる。差が無い普段は0で、何も動かない。
 *
 * しきい値未満を0にするのは keyboardInsetFrom と同じ理由(ツールバーの出入り程度の
 * 小さい差で追従ボタンが揺れないように)。 */
export const VIEWPORT_GAP_THRESHOLD_PX = 40;

export function staleViewportGap(layoutHeight: number, visualHeight: number, visualOffsetTop: number): number {
  const gap = visualHeight + visualOffsetTop - layoutHeight;
  if (!Number.isFinite(gap) || gap < VIEWPORT_GAP_THRESHOLD_PX) return 0;
  return Math.round(gap);
}

/** 上の差を CSS 変数 --viewport-gap として置き、画面下に貼りつくもの(追従ボタン・
 * シート・知らせ)がそれを見て自分の位置を直せるようにする。値を書き込むこと自体が
 * 描き直しのきっかけにもなる — iOSのfixedは「何かのきっかけで描き直されるまで」
 * ずれた場所に残るため。
 *
 * 返り値は後始末の関数。 */
export function trackViewportGap(): () => void {
  const visual = typeof window === "undefined" ? null : window.visualViewport;
  if (!visual) return () => {};

  let applied = -1;
  const update = () => {
    const gap = staleViewportGap(window.innerHeight, visual.height, visual.offsetTop);
    if (gap === applied) return;
    applied = gap;
    document.documentElement.style.setProperty("--viewport-gap", `${gap}px`);
  };

  update();
  visual.addEventListener("resize", update);
  visual.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  // アプリに戻ってきた時。iOSは裏に回っている間に高さを変えても知らせてこない。
  document.addEventListener("visibilitychange", update);
  return () => {
    visual.removeEventListener("resize", update);
    visual.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
    document.removeEventListener("visibilitychange", update);
  };
}
