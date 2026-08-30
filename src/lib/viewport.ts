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

/** 見えている領域が動いている最中は測った差を書き込まず、止まるのを待つ時間(ms)。
 *
 * スクロールしている間、iOSは visualViewport の高さ・位置を細かく動かす — 端での
 * ラバーバンド(引っぱると画面ごと数十px動く)や、ツールバーの出入りがその途中経過まで
 * scroll/resize で流れてくる。その瞬間の値をそのまま書き込むと、指を動かしている間
 * だけ追従ボタンと追従ナビが数十px下へずれ、指を離すと戻る(2026-08-31 再発の報告)。
 *
 * この変数が直したいのは「キーボードを閉じたあと、画面の高さが戻らないまま止まって
 * いる」状態で、それは動きが止まったあとも残り続けるもの。動いている最中の値を
 * 見送っても直せる。 */
export const VIEWPORT_GAP_SETTLE_MS = 250;

/** いま動いている監視に「測り直して」と伝える口。visualViewport が何も知らせて
 * こない場面のために要る。
 *
 * iOSは、キーボードが出ている入力欄が画面ごと消えた時(画面を切り替えた・シートを
 * 閉じた)に focusout を出さないことがある。その時 window.innerHeight は
 * キーボードぶん短いままで、visualViewport 側の resize / scroll も来ないので、
 * この仕組みは「差が無い」と思い込んだまま止まる。結果、追従ナビと追加ボタんが
 * 画面の途中に貼りついたまま戻らない(2026-08-31 の報告)。
 *
 * そこで、画面を切り替えた時(src/App.tsx)と画面を触った時に、ここから測り直す。 */
let scheduledUpdate: (() => void) | null = null;

export function refreshViewportGap(): void {
  scheduledUpdate?.();
}

/** 上の差を CSS 変数 --viewport-gap として置き、画面下に貼りつくもの(追従ボタン・
 * シート・知らせ)がそれを見て自分の位置を直せるようにする。値を書き込むこと自体が
 * 描き直しのきっかけにもなる — iOSのfixedは「何かのきっかけで描き直されるまで」
 * ずれた場所に残るため。
 *
 * 測るのは「動きが止まってから」— 途中経過に反応しない(VIEWPORT_GAP_SETTLE_MS)。
 *
 * 返り値は後始末の関数。 */
export function trackViewportGap(): () => void {
  const visual = typeof window === "undefined" ? null : window.visualViewport;
  if (!visual) return () => {};

  let applied = -1;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  /** 今の状態を測って書く。呼ぶのは「止まっている」と分かっている時だけ。 */
  const write = () => {
    settleTimer = undefined;
    const gap = staleViewportGap(window.innerHeight, visual.height, visual.offsetTop);
    if (gap === applied) return;
    applied = gap;
    document.documentElement.style.setProperty("--viewport-gap", `${gap}px`);
  };

  // 動いている間に届いた分は、そのつど先送りする。最後の1回だけが実際に測る。
  const update = () => {
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    settleTimer = setTimeout(write, VIEWPORT_GAP_SETTLE_MS);
  };

  // 起動時は止まっているので、待たずにそのまま測る。
  write();
  scheduledUpdate = update;
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
  // 何かを触った時。上の引き金がどれも来なかった場合の最後の受け皿で、次に画面を
  // 触った時点で必ず測り直す(押した瞬間ではなく、動きが止まってから測る)。
  document.addEventListener("pointerup", update, { passive: true });
  document.addEventListener("touchend", update, { passive: true });
  return () => {
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    scheduledUpdate = null;
    visual.removeEventListener("resize", update);
    visual.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
    document.removeEventListener("visibilitychange", update);
    document.removeEventListener("focusout", update);
    document.removeEventListener("pointerup", update);
    document.removeEventListener("touchend", update);
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
