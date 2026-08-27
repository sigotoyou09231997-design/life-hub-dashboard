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
  // キーボードを閉じた直後。iOSはこの時に window.innerHeight を戻し損ねることが
  // あり、visualViewport 側の resize/scroll がその失敗まで知らせてくれるとは限らない
  // (シート個別のキーボード対応 — Sheet.tsx — は同じ理由でここに focusout を使っている。
  // 追従ボタン・追従ナビゲーションはシートの外で常に浮いているので、シートの中の
  // 対応だけでは直らない。ここにも同じ引き金を持たせる)。
  document.addEventListener("focusout", update);
  return () => {
    visual.removeEventListener("resize", update);
    visual.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
    document.removeEventListener("visibilitychange", update);
    document.removeEventListener("focusout", update);
  };
}

/** シートの器と画面の端のあいだに残す隙間(px)。 */
export const SHEET_EDGE_GAP_PX = 8;

/**
 * シートの器の高さの上限(px)。null を返したら、CSSの既定(88vh等)のままでよい。
 *
 * 「キーボードのぶんを下に空けた残り」に合わせるだけでは足りない。iOSはキーボードを
 * 出す時に、見えている領域そのものを下へずらすことがあり(visualViewport.offsetTop)、
 * レイアウト上の画面の高さから引いた残りには、そのずれたぶん — 画面の上に隠れて
 * いて見えない帯 — まで含まれてしまう。シートは画面の下端を基準に置くので、その帯の
 * ぶんだけ器の上側がはみ出し、つまみ・見出し・最初の入力欄が画面の上に隠れる。器は
 * position:fixed で、ページのスクロールは止めてあるため、そこへは戻れない
 * (「予定追加で上までスクロールできない」= 2026-08-26の報告)。
 *
 * 実際に見えている高さ(visualViewport.height)に収めれば、器は必ず見えている帯の
 * 中に入る。キーボードが出ていない時は今まで通り画面の88%(compactは55%)まで。
 */
export function sheetMaxHeightPx(
  visibleHeight: number | null,
  keyboardInset: number,
  compact: boolean,
): number | null {
  if (!visibleHeight || visibleHeight <= 0) return null;
  const fits = Math.max(0, visibleHeight - SHEET_EDGE_GAP_PX);
  // キーボードが出ている間は、残っている見えている高さいっぱいまで使う。
  if (keyboardInset > 0) return fits;
  return Math.min(fits, Math.round(visibleHeight * (compact ? 0.55 : 0.88)));
}
