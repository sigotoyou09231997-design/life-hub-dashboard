import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type ToastTone = "success" | "error";

interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

const DURATION_MS = 2500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const idRef = useRef(0);

  const show = useCallback((message: string, tone: ToastTone = "success") => {
    window.clearTimeout(timerRef.current);
    idRef.current += 1;
    setToast({ id: idRef.current, message, tone });
    timerRef.current = window.setTimeout(() => setToast(null), DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        role="status"
        // Cleared to sit above QuickActionBar (a fixed bottom bar on every page since
        // the glass redesign), not just the safe-area inset.
        // bottom から引いている --viewport-gap は、追従ボタンと同じ位置直し
        // (iOSが画面の高さを戻し損ねている間だけ効く。src/lib/viewport.ts)。
        className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+6rem-var(--viewport-gap,0px))] z-[60] flex justify-center px-5 lg:bottom-8"
      >
        {toast && (
          <div
            key={toast.id}
            className={`animate-slide-up motion-reduce:animate-none pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-lg ${
              toast.tone === "error" ? "bg-danger" : "bg-slate-900"
            }`}
          >
            {toast.tone === "error" ? (
              <XCircle size={16} className="shrink-0" />
            ) : (
              <CheckCircle2 size={16} className="shrink-0" />
            )}
            {toast.message}
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
