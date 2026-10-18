/**
 * 押すと沈んで、ばねで戻る（UI/UX 調査メモ 第4弾 A-1、2026-10-12）。
 *
 * ボタン・押せるカード・チップ・タブ・下のナビを押した瞬間に約0.08秒で少し縮め、離すと
 * theme-teal.css の --spring（少し行き過ぎてから収まる曲線）で元の大きさへ戻す。
 * アプリ全体に1か所から効かせるため、document で指の出来事を聞き、決まったクラスの要素を
 * 見つけて動かす（ページ側の JSX には手を入れない。useDesignMotion.ts と同じ考え方）。
 *
 * CSS の :active ではなく JS（Web Animations）にした理由:
 * - 縮めるのは独立した `scale` プロパティ。`transform` を使う今ある動き（ホームの黒いカードの
 *   傾き・右下の「＋」の回転・PCでカードが持ち上がる動き）を上書きせず、掛け合わさる。
 *   以前は各ファイルの `:active { transform: scale(…) }` が傾きを打ち消していた。
 * - 押す時は速く、離す時はばね、と行きと帰りで曲線を変えたい。CSS でやるには、対象ごとに
 *   今ある transition の一覧へ scale を書き足す必要がある（transition は足し算できない）。
 *   20種類近い部品の transition を全部書き直すことになり、どれかを直すたびに食い違う。
 * - 指でスクロールを始めただけで沈まないよう、指の時だけ少し待つ（TOUCH_DELAY_MS）。
 *   :active ではこの区別ができず、カードの並ぶホームをスクロールするたびに触れたカードが縮む。
 *
 * 影（B-4）は CSS の受け持ち: 押している間だけ data-pressed を付け、touch-tokens.css が
 * 影を --shadow-press へ縮める。
 *
 * 動きを減らす設定（prefers-reduced-motion: reduce）では何もしない。
 */

/** 押すと沈むもの。ここに無い部品（一覧の行のボタン・チェックの丸など）は今までどおり。 */
const PRESS_TARGETS = [
  // ボタン
  ".app-button",
  "#page-fab-root > button",
  ".app-header__add",
  ".sheet-close",
  ".lh-money__cta",
  '.spatial-page-header button[aria-label$="を追加"]',
  '.mail-page-header button[aria-label$="を追加"]',
  ".feedback-button",
  // 押せるカード・行
  ".card-interactive",
  ".is-pressable",
  ".note-widget",
  ".hub-tap",
  "a.warm-card",
  "a.warm-trip",
  // ホームの組み直しで足したカードの中の押せる所(2026-10-18)
  ".lh-week__day",
  ".lh-subs__row",
  ".lh-concern__row",
  ".warm-brief__item",
  ".subs-tile",
  ".trip-new",
  // チップ・選択肢
  ".lh-chip",
  ".subs-chip",
  ".person-chip",
  ".segmented__option",
  ".time-quick__chip",
  ".title-when__chip",
  ".choice-grid__option",
  ".trip-route__day",
  ".trip-day-pick__chip",
  ".trip-leg-mode",
  ".trip-leg-via__pick",
  // タブ・ナビ
  ".spatial-tabs button",
  '[role="tab"]',
  ".glass-nav nav a",
  ".glass-nav nav button",
  ".sidebar-link",
].join(",");

/** ここで押し始めたら沈ませない（文字を打つ所。カードの中の入力欄を触るたびにカードが縮まないように）。 */
const TEXT_ENTRY =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]';

/** 縮むまでの時間。 */
export const PRESS_IN_MS = 80;
/** 離してから、ばねで戻りきるまでの時間。 */
export const RELEASE_MS = 480;
/** 指の時だけ、この間に指が動かなければ「押した」と見なして沈ませる（スクロールの始まりでは沈まない）。 */
export const TOUCH_DELAY_MS = 60;
/** これより指が動いたら、押すのをやめたと見なして戻す（スクロール・横に払う操作）。 */
const MOVE_TOLERANCE_PX = 8;
/** theme-teal.css の --spring と同じ曲線。CSS 変数が読めない時だけ使う。 */
const SPRING_FALLBACK = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * 押した時の縮み具合。小さいボタンやチップは 0.96、大きなカードほど控えめにする
 * （画面幅いっぱいのカードを 0.96 にすると左右が 8px ずつ動いて、沈むより「ちぢむ」に見える）。
 * 長い辺で約12pxだけ縮む値にし、0.96〜0.985 の間に収める。
 * 要素の CSS に --press-scale があれば、そちらを使う（touch-tokens.css で右下の「＋」を深めにしている）。
 */
export function pressScaleFor(width: number, height: number, custom?: number): number {
  if (custom !== undefined && Number.isFinite(custom) && custom > 0 && custom < 1) return custom;
  const size = Math.max(width, height);
  if (!(size > 0)) return 0.96;
  return Math.min(0.985, Math.max(0.96, 1 - 12 / size));
}

/** 押し始めた所から、沈ませる要素を探す。沈ませない時は null。 */
export function findPressTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest(TEXT_ENTRY)) return null;
  const el = target.closest<HTMLElement>(PRESS_TARGETS);
  if (!el) return null;
  if (el.matches(':disabled, [aria-disabled="true"], [data-no-press]')) return null;
  // シート（role="dialog"）を中に持つ要素は縮めない。scale を持つ要素は、中の position:fixed の
  // 基準になってしまい、開いているシートがカードと一緒に縮んで画面の外へずれる
  // （Sheet.tsx はポータルを使っていない。index.css の .page-transition の注意と同じ理由）。
  if (el.querySelector('[role="dialog"]')) return null;
  return el;
}

interface Press {
  el: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  scale: number;
  /** 指の時の待ち。沈み始めたら null。 */
  timer: number | null;
  /** 沈んだまま止めている動き。 */
  anim: Animation | null;
}

/**
 * 押した感触をアプリ全体に付ける。main.tsx で1回だけ呼ぶ。戻り値で外せる（テスト用）。
 */
export function installPressFeedback(doc: Document = document): () => void {
  const win = doc.defaultView ?? window;
  const reduceQuery = typeof win.matchMedia === "function" ? win.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let current: Press | null = null;

  function springEasing(): string {
    const v = win.getComputedStyle(doc.documentElement).getPropertyValue("--spring").trim();
    return v || SPRING_FALLBACK;
  }

  /**
   * 戻っている途中で、押した要素の中にシートが開いたら、その場で動きをやめる。
   * 押したボタンの中にシートが描かれる部品だと、戻りきるまでの約0.5秒、シートが縮んだ要素を
   * 基準にずれて出てしまうため（findPressTarget の注意と同じ理由）。
   */
  function stopIfDialogOpens(anim: Animation, el: HTMLElement) {
    const raf = win.requestAnimationFrame?.bind(win);
    if (!raf) return;
    const tick = () => {
      if (anim.playState !== "running") return;
      if (el.querySelector('[role="dialog"]')) {
        anim.cancel();
        return;
      }
      raf(tick);
    };
    raf(tick);
  }

  function pressIn(p: Press) {
    p.timer = null;
    p.el.setAttribute("data-pressed", "");
    p.anim = p.el.animate([{ scale: "1" }, { scale: String(p.scale) }], {
      duration: PRESS_IN_MS,
      easing: "ease-out",
      fill: "forwards",
    });
  }

  /** 離した（tap = true）／やめた（スクロール・指が外れた、tap = false）。 */
  function release(p: Press, tap: boolean) {
    if (p.timer !== null) {
      // 沈む前に終わった。スクロールの始まりなら何も見せない。素早く押して離しただけなら、
      // 沈んで戻る動きを一続きで見せる（押したことが指に返るように）。
      win.clearTimeout(p.timer);
      p.timer = null;
      if (!tap) return;
      const el = p.el;
      el.setAttribute("data-pressed", "");
      const anim = el.animate(
        [
          { scale: "1", easing: "ease-out" },
          { scale: String(p.scale), offset: PRESS_IN_MS / (PRESS_IN_MS + RELEASE_MS), easing: springEasing() },
          { scale: "1" },
        ],
        { duration: PRESS_IN_MS + RELEASE_MS },
      );
      win.setTimeout(() => el.removeAttribute("data-pressed"), PRESS_IN_MS);
      stopIfDialogOpens(anim, el);
      return;
    }
    p.el.removeAttribute("data-pressed");
    // 沈みきる前に離した時も、今の大きさから戻す（いきなり 0.96 へ跳ばない）。
    const now = parseFloat(win.getComputedStyle(p.el).getPropertyValue("scale"));
    const from = Number.isFinite(now) && now > 0 && now <= 1 ? now : p.scale;
    const back = p.el.animate([{ scale: String(from) }, { scale: "1" }], {
      duration: RELEASE_MS,
      easing: springEasing(),
    });
    p.anim?.cancel();
    p.anim = null;
    stopIfDialogOpens(back, p.el);
  }

  function onDown(e: PointerEvent) {
    if (current) {
      release(current, false);
      current = null;
    }
    if (!e.isPrimary || e.button !== 0) return;
    if (reduceQuery?.matches) return;
    const el = findPressTarget(e.target);
    if (!el || typeof el.animate !== "function") return;
    const rect = el.getBoundingClientRect();
    const custom = parseFloat(win.getComputedStyle(el).getPropertyValue("--press-scale"));
    const p: Press = {
      el,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      scale: pressScaleFor(rect.width, rect.height, Number.isFinite(custom) ? custom : undefined),
      timer: null,
      anim: null,
    };
    current = p;
    if (e.pointerType === "mouse") pressIn(p);
    else p.timer = win.setTimeout(() => pressIn(p), TOUCH_DELAY_MS);
  }

  function onMove(e: PointerEvent) {
    if (!current || e.pointerId !== current.pointerId) return;
    if (Math.hypot(e.clientX - current.x, e.clientY - current.y) <= MOVE_TOLERANCE_PX) return;
    release(current, false);
    current = null;
  }

  function onUp(e: PointerEvent) {
    if (!current || e.pointerId !== current.pointerId) return;
    release(current, true);
    current = null;
  }

  function onCancel(e: PointerEvent) {
    if (!current || e.pointerId !== current.pointerId) return;
    release(current, false);
    current = null;
  }

  // 捕まえる段階（capture）で聞く。部品が pointerup の伝わりを止めても、戻し忘れないように。
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  doc.addEventListener("pointerdown", onDown, opts);
  doc.addEventListener("pointermove", onMove, opts);
  doc.addEventListener("pointerup", onUp, opts);
  doc.addEventListener("pointercancel", onCancel, opts);
  return () => {
    doc.removeEventListener("pointerdown", onDown, opts);
    doc.removeEventListener("pointermove", onMove, opts);
    doc.removeEventListener("pointerup", onUp, opts);
    doc.removeEventListener("pointercancel", onCancel, opts);
    if (current) {
      if (current.timer !== null) win.clearTimeout(current.timer);
      current.anim?.cancel();
      current.el.removeAttribute("data-pressed");
      current = null;
    }
  };
}
