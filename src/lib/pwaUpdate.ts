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
/** いま動いている版(コミットの頭7文字)。開発中は dev。設定に出して、「反映された?」をその場で確かめられるようにする。 */
export function currentVersion(): string {
  return typeof __APP_COMMIT__ === "string" && __APP_COMMIT__ ? __APP_COMMIT__.slice(0, 7) : "dev";
}

/** main.tsx が渡す、「いま新しい版が無いか確かめて」(registration.update())。 */
let checkFn: (() => Promise<void>) | null = null;
export function setUpdateChecker(fn: () => Promise<void>): void {
  checkFn = fn;
}

/**
 * 設定の「最新版にする」。公開されている版(/version.json)といま動いている版を見比べ、違えば切り替える。
 *
 * 切り替わらない時のために、最後は Service Worker と取り置きを捨てて読み込み直す(2026-10-12、
 * 「反映されてない」の確認で何度も往復したため。普段の更新は帯が出るまで待つが、ここは本人が押した時)。
 * 返り値: latest = すでに最新版 / updating = 切り替えている(まもなく読み込み直し) / unknown = 公開されている版を読めなかった。
 */
export async function updateToLatestNow(): Promise<"latest" | "updating" | "unknown"> {
  let deployed: string | null = null;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) deployed = ((await res.json()) as { version?: string }).version ?? null;
  } catch {
    // 通信できない時は、下で「読めなかった」と返す
  }
  if (!deployed) return "unknown";
  const running = currentVersion();
  if (running !== "dev" && deployed.startsWith(running)) return "latest";
  if (checkFn) await checkFn().catch(() => undefined);
  void applyUpdate();
  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      void (async () => {
        try {
          const registrations = await navigator.serviceWorker?.getRegistrations();
          await Promise.all((registrations ?? []).map((registration) => registration.unregister()));
          if (typeof caches !== "undefined") await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
        } catch {
          // 捨てられなくても、読み込み直しはする
        }
        window.location.reload();
      })();
    }, 4000);
  }
  return "updating";
}

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
