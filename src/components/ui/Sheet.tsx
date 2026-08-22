import { type ReactNode, useEffect, useRef } from "react";
import { X } from "lucide-react";

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
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  // Capture synchronously during render (before commit) rather than in an effect:
  // an autoFocus field inside the sheet's content steals focus during commit, which
  // runs before any passive useEffect — capturing there would record the sheet's own
  // input instead of the element that opened it.
  if (open && !wasOpen.current) {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
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

  if (!open) return null;

  return (
    <div
      className={`fixed inset-x-0 top-0 z-50 flex items-end justify-center lg:items-center lg:p-6 ${reserveBottomBar ? "bottom-[calc(env(safe-area-inset-bottom)+6.5rem)]" : "bottom-0"}`}
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
