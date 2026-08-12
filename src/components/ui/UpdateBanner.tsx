import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { applyUpdate, subscribeUpdateAvailable } from "../../lib/pwaUpdate";

const PROGRESS_DURATION_MS = 1500;

/** Interaction types that mean "the user is actively using the app right now" —
 * the moment to surface the update rather than yanking the page from under them. */
const INTERACTION_EVENTS = ["pointerdown", "keydown"] as const;

/** True while a Sheet (add/edit form) is open — Sheet.tsx is the only place that
 * locks body scroll, so this doubles as "don't reload mid-edit". */
function isFormOpen(): boolean {
  return document.body.style.overflow === "hidden";
}

export function UpdateBanner() {
  const [phase, setPhase] = useState<"idle" | "updating">("idle");
  const [filled, setFilled] = useState(false);
  const armedRef = useRef(false);

  useEffect(() => {
    function armInteractionWatch() {
      if (armedRef.current) return;
      armedRef.current = true;

      function onInteraction() {
        // Defer the check a frame: a pointerdown that itself opens a Sheet fires
        // before React commits that state change, so isFormOpen() would still
        // read false at this instant even though a form is about to appear.
        requestAnimationFrame(() => {
          if (isFormOpen()) return; // keep watching; don't interrupt an open form
          INTERACTION_EVENTS.forEach((type) => document.removeEventListener(type, onInteraction));
          setPhase("updating");
        });
      }

      INTERACTION_EVENTS.forEach((type) => document.addEventListener(type, onInteraction, { passive: true }));
    }

    return subscribeUpdateAvailable(armInteractionWatch);
  }, []);

  useEffect(() => {
    if (phase !== "updating") return;
    const raf = requestAnimationFrame(() => setFilled(true));
    let cancelled = false;
    let timeoutId: number;

    // Re-checked at fire time (and re-armed if needed) so a form opened *during*
    // the animation still gets to finish before the reload happens.
    function scheduleApply(delay: number) {
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        if (isFormOpen()) {
          scheduleApply(1000);
          return;
        }
        void applyUpdate();
      }, delay);
    }
    scheduleApply(PROGRESS_DURATION_MS + 150);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timeoutId);
    };
  }, [phase]);

  if (phase === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[80] animate-slide-down motion-reduce:animate-none"
    >
      <div className="bg-slate-900 pt-[env(safe-area-inset-top)] text-white shadow-lg">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
          <Download size={18} className="shrink-0 text-white/80" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">アップデートが来ています</p>
            <p className="mt-0.5 text-xs text-white/60">最新版に更新しています…</p>
          </div>
        </div>
        <div className="h-1 w-full bg-white/15">
          <div
            className="h-full bg-accent transition-[width] ease-linear motion-reduce:transition-none"
            style={{ width: filled ? "100%" : "0%", transitionDuration: `${PROGRESS_DURATION_MS}ms` }}
          />
        </div>
      </div>
    </div>
  );
}
