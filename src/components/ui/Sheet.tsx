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
  // シートを開いた時のページのスクロール位置。iOSはキーボードを出す時にページごと
  // 上へずらすことがあり、閉じても戻らないと position:fixed のシートまでずれたままに
  // なる。キーボードが引っ込んだら、ここへ戻す。
  const scrollYRef = useRef(0);
  /** キーボードでシートを持ち上げたか。閉じた後に位置を戻すのは、この時だけ。 */
  const liftedRef = useRef(false);

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
      const typing = opensKeyboard(document.activeElement);
      const hidden = typing ? keyboardInsetFrom(window.innerHeight, visual.height, visual.offsetTop) : 0;
      if (hidden > 0) liftedRef.current = true;
      setKeyboardInset(hidden);
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
    >
      <div className="spatial-sheet-backdrop absolute inset-0 animate-fade-in motion-reduce:animate-none" onClick={onClose} aria-hidden />
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
        <div className={`sheet-body min-h-0 flex-1 overflow-y-auto ${reserveBottomBar ? "!pb-5" : ""}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
