/** Tiny pub-sub bridging main.tsx's vanilla registerSW() call and the React
 * tree, since the service-worker registration happens outside any component. */

type Listener = () => void;

let updateAvailable = false;
let applyFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
const listeners = new Set<Listener>();

/** Called once from main.tsx with the function `registerSW()` returns. */
export function setUpdateApplier(fn: (reloadPage?: boolean) => Promise<void>): void {
  applyFn = fn;
}

/** Called from main.tsx's `onNeedRefresh` when a new service worker is waiting. */
export function markUpdateAvailable(): void {
  if (updateAvailable) return;
  updateAvailable = true;
  listeners.forEach((listener) => listener());
}

export function isUpdateAvailable(): boolean {
  return updateAvailable;
}

/** Fires once, synchronously, if an update is already available at subscribe time. */
export function subscribeUpdateAvailable(listener: Listener): () => void {
  listeners.add(listener);
  if (updateAvailable) listener();
  return () => listeners.delete(listener);
}

/** Tells the waiting service worker to take over and reloads the page once it does.
 * The reload itself is driven by a "controlling" service-worker event registered
 * back when the update was first detected — it normally fires within a moment of
 * skip-waiting, but isn't guaranteed to (e.g. several deploys landing back-to-back
 * can leave a stale listener pointed at a since-superseded worker). Force a reload
 * shortly after regardless, so the banner can never hang open indefinitely; a no-op
 * once the natural reload has already navigated the page away. */
export async function applyUpdate(): Promise<void> {
  if (applyFn) await applyFn(true);
  if (typeof window === "undefined") return; // non-browser environment (tests)
  window.setTimeout(() => {
    try {
      window.location.reload();
    } catch {
      // reload not implemented in this environment — nothing more to do
    }
  }, 2000);
}
