import { type ReactNode, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { keyboardInsetFrom, opensKeyboard, sheetMaxHeightPx } from "../../lib/viewport";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Stops the sheet short of the very bottom of the viewport instead of the
   * usual inset-0, so the global QuickActionBar stays visible underneath it
   * (matches the Gmail detail sheet in the reference design). Every other
   * Sheet in the app keeps the default full-bleed behavior. */
  reserveBottomBar?: boolean;
  /** Caps the panel at roughly half the viewport instead of the default
   * max-h-[88vh], so the list/page behind it stays partly visible (used only
   * by the Gmail mobile detail sheet — every other Sheet keeps the taller
   * default, since most of them are forms that need the room). */
  compact?: boolean;
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'input, textarea, select, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null); // skip hidden elements
}

/** input/textareaの中で、幅のある範囲が選択されている(コピーしようとしている)か。
 * input, output, select, keygen 以外の一部のtype(email, number, time など)は
 * selectionStart/Endを持たず読み取ると例外を投げるため、その時はfalseに丸める
 * (選択の心配が無い部品として扱う)。 */
function hasTextSelection(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  try {
    return el.selectionStart !== null && el.selectionStart !== el.selectionEnd;
  } catch {
    return false;
  }
}

/**
 * フォーカス中の欄を、下に貼りついた操作の帯(.form-actions、キャンセル/保存)より上へ出す。
 *
 * 帯は .sheet-body の中に position:sticky で貼りついているので、scrollIntoView も iOS の
 * 「打っている所を見せる」も、帯の裏を「見えている範囲」と数えてしまう。キーボードが出ると
 * 帯はキーボードの真上に来るため、入力欄の下側(打っている行)が帯とキーボードの裏に入り、
 * 「キーボードと入力している文字がかぶる」(2026-10-11、iPhone のホーム画面アプリで「修正」の
 * 入力欄)。欄が見える範囲に収まるなら下端を帯の上へ、収まらないなら上端を見える範囲の上に合わせる。
 */
/** 押して使う部品。この上に触れた時は、触れた瞬間にはフォーカスを外さない(下の touchstart)。 */
const PRESSABLE_SELECTOR = 'input, textarea, select, button, a[href], label, [role="button"], [contenteditable="true"]';
/** これより指が動いたら、押したのではなくスクロールを始めたとみなす(px)。 */
const SCROLL_INTENT_PX = 8;
/** 触れてからこれより後に動き始めた指は、長押し(貼り付け・カーソル移動)とみなしてフォーカスを外さない(ms)。 */
const LONG_PRESS_MS = 300;

export function revealAboveActions(body: HTMLElement, field: HTMLElement): void {
  const actions = body.querySelector<HTMLElement>(".form-actions");
  if (!actions || actions.contains(field)) return;
  const GAP = 8;
  const limit = actions.getBoundingClientRect().top - GAP;
  const top = body.getBoundingClientRect().top + GAP;
  const rect = field.getBoundingClientRect();
  if (rect.bottom <= limit) return;
  const shift = rect.height <= limit - top ? rect.bottom - limit : rect.top - top;
  if (shift > 0) body.scrollTop += shift;
}

export function Sheet({ open, onClose, title, children, reserveBottomBar = false, compact = false }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  // キーボードで隠れている高さ。その分だけシートを持ち上げて、入力欄が最初から
  // キーボードの上に出ている状態にする(src/lib/viewport.ts)。
  const [keyboardInset, setKeyboardInset] = useState(0);
  // 実際に見えている高さ。レイアウト上の画面の高さ(vh)より小さいことがあり、
  // その時はvhに合わせるとシートの下側(操作ボタン)が画面の外に出る。
  const [visibleHeight, setVisibleHeight] = useState<number | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  // 中身をスクロールする.sheet-body(下のJSXでrefを渡す)。キーボード対応
  // (下の指でスクロールを始めた時にフォーカスを外す処理)専用の参照。
  const bodyRef = useRef<HTMLDivElement>(null);
  // シートを開いた時のページのスクロール位置。iOSはキーボードを出す時にページごと
  // 上へずらすことがあり、閉じても戻らないと position:fixed のシートまでずれたままに
  // なる。キーボードが引っ込んだら、ここへ戻す。
  const scrollYRef = useRef(0);
  /** キーボードでシートを持ち上げたか。閉じた後に位置を戻すのは、この時だけ。 */
  const liftedRef = useRef(false);
  /** いまの指(ポインタ)を、シートの中で置いたか。外側(暗い所)のクリックで閉じてよいかの判断に使う。 */
  const pressedInPanelRef = useRef(false);

  // Capture synchronously during render (before commit) rather than in an effect:
  // an autoFocus field inside the sheet's content steals focus during commit, which
  // runs before any passive useEffect — capturing there would record the sheet's own
  // input instead of the element that opened it.
  if (open && !wasOpen.current) {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    scrollYRef.current = window.scrollY;
  }
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return;

    // bodyだけを止めても、iOSはbodyとhtmlをまとめて1つのスクロール領域として扱うため
    // 裏のページがスクロールできてしまうことがある(WebKitの既知の挙動)。htmlも
    // 一緒に止めることで、シートの裏でページ自体が動く余地を無くす。
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    // Focus the first real input/textarea/select if present (most forms lead
    // with one), otherwise the first focusable element (e.g. a picker's first
    // option button). Runs after paint so the sheet has mounted.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = getFocusable(panel);
      const preferred = focusables.find((el) => ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      (preferred ?? focusables[0])?.focus();
    });

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = getFocusable(panelRef.current);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(raf);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const visual = window.visualViewport;
    if (!visual) return;
    const update = () => {
      // 文字を入れる部品に focus が無ければキーボードは出ていない。iOSが閉じたことを
      // 知らせ損ねた時に、シートが浮いたまま戻らなくなるのを防ぐ(src/lib/viewport.ts)。
      const active = document.activeElement as HTMLElement | null;
      const typing = opensKeyboard(active);
      const hidden = typing ? keyboardInsetFrom(window.innerHeight, visual.height, visual.offsetTop) : 0;
      if (hidden > 0) liftedRef.current = true;
      setKeyboardInset(hidden);
      // キーボードが出て器(.sheet-panel)の高さが縮む(下のsheetMaxHeightPx)と、
      // .sheet-bodyの見えている範囲の下端がそのぶん上へ後退する。スクロール位置は
      // 変わらないので、いちばん下の項目(最後の入力欄・その次に貼りつくキャンセル/
      // 保存ボタン)にフォーカスしたまま器が縮むと、その欄が縮んだ範囲の外(下側)へ
      // 出てしまい、キーボードを開いてもその欄が見えない・触れないままになる
      // (2026-09-20の報告、「いちばん下の項目に入力できない」)。
      // 縮んだ直後にフォーカス中の欄を範囲内へ入れ直す。requestAnimationFrameで
      // 1拍置くのは、器の高さ(maxHeightPx)の再計算がReactの描画を経てから反映される
      // ため — 同期で呼ぶと縮む前の高さのまま計算してしまう。
      if (hidden > 0 && active && bodyRef.current?.contains(active)) {
        const body = bodyRef.current;
        requestAnimationFrame(() => {
          active.scrollIntoView({ block: "nearest" });
          revealAboveActions(body, active);
        });
      }
      // キーボードで持ち上がった後、閉じてもページがずれたままなら開いた時の位置へ戻す。
      // 持ち上がった後だけにするのは、それ以外で勝手にスクロールさせないため。
      if (!typing && liftedRef.current) {
        liftedRef.current = false;
        if (window.scrollY !== scrollYRef.current) window.scrollTo(0, scrollYRef.current);
      }
      // 見えている高さと、レイアウト上の画面の高さが食い違っている時だけ持つ。
      // 小さい時ははみ出さないように、大きい時(iOSが高さを戻し損ねている時)は
      // シートが不必要に小さくならないように、どちらもこちらに合わせる。
      setVisibleHeight(Math.abs(visual.height - window.innerHeight) > 1 ? Math.round(visual.height) : null);
    };
    update();
    visual.addEventListener("resize", update);
    visual.addEventListener("scroll", update);
    // focus が移った時にも引き直す。キーボードの開け閉めは focus の移動と一緒に起きる。
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      visual.removeEventListener("resize", update);
      visual.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      setKeyboardInset(0);
      setVisibleHeight(null);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const body = bodyRef.current;
    if (!body) return;
    // iOSは、フォーカス中の入力欄がスクロールで画面(キーボードの上の見えている範囲)の
    // 外へ出ると、その欄を追いかけてスクロールを勝手に戻してしまう(WebKitの既知の
    // 挙動。フォーカスを外へ出したまま = キーボードは出たまま、なのでOS側が
    // 「見えるようにしなければ」と毎回引き戻す)。この画面は.sheet-body側だけを
    // スクロールさせているが、iOSはその区別をしてくれないため、上の方の入力欄に
    // フォーカスしたまま下の項目を見ようとして指でスクロールしても、そのたびに
    // 引き戻されて下の項目に入力できなくなる(2026-09-20の報告)。
    //
    // 最初はtouchmove(指が動いた時点)でフォーカスを外していたが、それでも直らな
    // かった(2026-09-20の再報告)。iOS側の引き戻しは指が動き始めるより前、触れた
    // 瞬間(touchstart)から始まっている可能性があり、touchmoveまで待つと手遅れに
    // なると考えられる。そこでtouchstart — 指が触れた瞬間 — で、動きの向きも距離も
    // 見ずに即フォーカスを外す。
    //
    // ただし、文字を選択中(コピーしようとして選択ハンドルをドラッグしている等)は
    // 外さない。selectionStart/Endの間に幅があれば選択中とみなす。ここで外して
    // しまうと選択そのものが消えてコピーできなくなる(2026-09-20の報告、「文字を
    // コピーできない」)。選択が無い(ただのカーソル)時だけ、スクロールのために外す。
    //
    // また、入力欄・ボタンなど押して使う部品の上に指が触れた時は、触れた瞬間には外さない
    // (2026-10-12)。触れた瞬間に外すとキーボードが閉じてシートが下がり、指を離す前に
    // 指の下が別の物に入れ替わる。そのせいで、
    //   - URL を貼ろうと入力欄をもう一度押すと、違う場所が選ばれて貼れない(要望の受信箱)
    //   - 旅行の「写真・文章から追加・更新」で、押すとシートが下がって入力した文が見えなくなる
    // が起きていた。その上ではスクロールだと分かった時(指を置いてすぐ動かした時)だけ外す。
    // 長押し(貼り付けのメニュー・カーソルの移動)は、しばらく指を止めてから動くので外さない。
    // 押して使う部品以外(余白・見出し・説明文)に触れた時は、これまでどおり触れた瞬間に外す。
    let pending: { x: number; y: number; at: number } | null = null;
    const handleTouchStart = (event: TouchEvent) => {
      pending = null;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !opensKeyboard(active)) return;
      if (hasTextSelection(active)) return;
      const target = event.target instanceof Element ? event.target : null;
      const touch = event.touches[0];
      if (target?.closest(PRESSABLE_SELECTOR) && touch) {
        pending = { x: touch.clientX, y: touch.clientY, at: Date.now() };
        return;
      }
      active.blur();
    };
    const handleTouchMove = (event: TouchEvent) => {
      if (!pending) return;
      const touch = event.touches[0];
      if (!touch) return;
      if (Math.hypot(touch.clientX - pending.x, touch.clientY - pending.y) < SCROLL_INTENT_PX) return;
      const scrolling = Date.now() - pending.at <= LONG_PRESS_MS;
      pending = null;
      if (!scrolling) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && opensKeyboard(active) && !hasTextSelection(active)) active.blur();
    };
    const clearPending = () => {
      pending = null;
    };
    body.addEventListener("touchstart", handleTouchStart, { passive: true });
    body.addEventListener("touchmove", handleTouchMove, { passive: true });
    body.addEventListener("touchend", clearPending, { passive: true });
    body.addEventListener("touchcancel", clearPending, { passive: true });
    return () => {
      body.removeEventListener("touchstart", handleTouchStart);
      body.removeEventListener("touchmove", handleTouchMove);
      body.removeEventListener("touchend", clearPending);
      body.removeEventListener("touchcancel", clearPending);
    };
  }, [open]);

  const maxHeightPx = sheetMaxHeightPx(visibleHeight, keyboardInset, compact);

  if (!open) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-end justify-center lg:items-center lg:p-6"
      style={{
        // 下端は inline で持つ。--viewport-gap は、iOSが画面の高さを戻し損ねている
        // 間の足りない分(src/lib/viewport.ts)。そのぶん下へ伸ばさないと、シートが
        // 画面の途中で止まる。普段は0pxで、これまでと同じ位置。
        bottom: `calc(${reserveBottomBar ? "env(safe-area-inset-bottom) + 6.5rem" : "0px"} - var(--viewport-gap, 0px))`,
        // キーボードのぶんを下に空けると、items-end のシートはその上まで持ち上がる。
        ...(keyboardInset > 0 ? { paddingBottom: keyboardInset } : null),
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDownCapture={(event) => {
        pressedInPanelRef.current = panelRef.current?.contains(event.target as Node) ?? false;
      }}
    >
      <div
        className="spatial-sheet-backdrop absolute inset-0 animate-fade-in motion-reduce:animate-none"
        onClick={() => {
          // シートの中で触り始めた指が、離した時には外側(暗い所)の上にあっても閉じない。
          // iPhone では、キーボードを出したまま下の方を押すと、触れた瞬間にフォーカスが外れて
          // (上の touchstart)キーボードが閉じ、シートが下りる。指を離す頃には同じ場所が外側に
          // なっていて、押したつもりのない「外側のクリック」で編集画面ごと消えていた(2026-10-11)。
          if (pressedInPanelRef.current) {
            pressedInPanelRef.current = false;
            return;
          }
          onClose();
        }}
        aria-hidden
      />
      <div
        ref={panelRef}
        className={`glass-modal spatial-sheet sheet-panel relative z-10 flex w-full max-w-md flex-col animate-slide-up motion-reduce:animate-none lg:max-w-xl ${
          compact ? "h-[55vh] max-h-[55vh]" : "max-h-[88vh] lg:max-h-[86vh]"
        }`}
        // キーボードが出ている間は、画面の高さ(88vh等)ではなく「いま実際に見えて
        // いる高さ」に合わせる。キーボードが無くても、見えている高さがvhより小さい
        // 時はそちらに合わせる — はみ出すと下の操作ボタンに手が届かない
        // (どちらも src/lib/viewport.ts の sheetMaxHeightPx)。
        style={
          maxHeightPx !== null
            ? { maxHeight: `${maxHeightPx}px` }
            : keyboardInset > 0
              ? { maxHeight: "calc(100% - 0.5rem)" }
              : undefined
        }
      >
        {/* つまみはスマホだけ。PCではダイアログとして画面の真ん中に置くので、
            下から引き上げる部品の名残を残さない(CSSで隠す)。 */}
        <div className="sheet-grip shrink-0" aria-hidden="true">
          <span />
        </div>
        <div className="sheet-head shrink-0">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="sheet-close">
            <X size={19} />
          </button>
        </div>
        <div ref={bodyRef} className={`sheet-body min-h-0 flex-1 overflow-y-auto ${reserveBottomBar ? "!pb-5" : ""}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
