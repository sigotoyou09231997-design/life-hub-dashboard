import { createContext, useContext, useEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import {
  flushToast,
  getToastSnapshot,
  pauseToast,
  resumeToast,
  runToastAction,
  showToast,
  subscribeToast,
  type ToastOptions,
  type ToastTone,
} from "./toastStore";

export type { ToastOptions, ToastTone } from "./toastStore";

/** showToast(message, tone?) は今までどおり。第2引数に { action, duration, onClose } も渡せる
 * (UI/UX 調査メモ 第4弾 A-2。「元に戻す」は src/components/ui/undoToast.ts から出すのが短い)。 */
type ShowToast = (message: string, toneOrOptions?: ToastTone | ToastOptions) => number;

const ToastContext = createContext<ShowToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  // 中身は React の外(toastStore)にある。画面の外の関数(タスクの完了など)からも出せるように。
  const toast = useSyncExternalStore(subscribeToast, getToastSnapshot, getToastSnapshot);

  useEffect(() => {
    // 画面が隠れたら、出ているお知らせを閉じる。「削除しました・元に戻す」の削除はここで書き切る
    // (src/lib/deferredDelete.ts も同じ時に書き切る)。戻ってきた時に、もう効かない「元に戻す」を
    // 残しておかないためでもある。
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushToast();
    };
    window.addEventListener("pagehide", flushToast);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushToast);
      document.removeEventListener("visibilitychange", onVisibility);
      // 置き場ごと無くなる時(ログイン画面とアプリの切り替え・テストの後片付け)も、
      // 待っている削除を宙に浮かせない。
      flushToast();
    };
  }, []);

  const hasAction = Boolean(toast?.actionLabel);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div
        aria-live="polite"
        role="status"
        // Cleared to sit above QuickActionBar (a fixed bottom bar on every page since
        // the glass redesign), not just the safe-area inset.
        // bottom から引いている --viewport-gap は、追従ボタンと同じ位置直し
        // (iOSが画面の高さを戻し損ねている間だけ効く。src/lib/viewport.ts)。
        // undo-toast-region--action: 「元に戻す」付きは横に長いので、スマホで右下の「＋」がある時は
        // その幅だけ右を空ける(重ならないように。src/styles/undo-toast.css)。
        className={`undo-toast-region pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+6rem-var(--viewport-gap,0px))] z-[60] flex justify-center px-5 lg:bottom-8 ${
          hasAction ? "undo-toast-region--action" : ""
        }`}
      >
        {toast && (
          <div
            key={toast.id}
            // 指が乗っている間・ボタンに焦点がある間は時間を止める(読み終える前に消えると押せない)。
            onPointerEnter={() => pauseToast(toast.id)}
            onPointerLeave={() => resumeToast(toast.id)}
            onFocus={() => pauseToast(toast.id)}
            onBlur={() => resumeToast(toast.id)}
            className={`animate-slide-up motion-reduce:animate-none pointer-events-auto relative flex max-w-full items-center gap-2 overflow-hidden rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-lg ${
              toast.tone === "error" ? "bg-danger" : "bg-slate-900"
            } ${hasAction ? "undo-toast" : ""}`}
          >
            {toast.tone === "error" ? (
              <XCircle size={16} className="shrink-0" />
            ) : (
              <CheckCircle2 size={16} className="shrink-0" />
            )}
            <span className={hasAction ? "undo-toast__message" : undefined}>{toast.message}</span>
            {toast.actionLabel && (
              <>
                <button type="button" className="undo-toast__action" onClick={() => runToastAction(toast.id)}>
                  {toast.actionLabel}
                </button>
                {/* 残り時間。下の細い線が右から縮んで、なくなった時に閉じる。 */}
                <span
                  aria-hidden="true"
                  className={`undo-toast__bar ${toast.paused ? "is-paused" : ""}`}
                  style={{ "--undo-toast-duration": `${toast.duration}ms` } as CSSProperties}
                />
              </>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
