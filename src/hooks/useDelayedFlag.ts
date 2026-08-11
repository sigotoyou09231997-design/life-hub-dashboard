import { useEffect, useState } from "react";

/**
 * Returns true only once `active` has been continuously true for `delayMs`.
 * Local Dexie queries usually resolve in a few milliseconds, so rendering a
 * loading state on every render would just flicker; this only reveals it
 * once loading is actually taking long enough to notice.
 */
export function useDelayedFlag(active: boolean, delayMs = 150): boolean {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const timer = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return show;
}
