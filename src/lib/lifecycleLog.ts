/**
 * アプリの動き(起動・裏に回った・戻った・版の切り替え・エラー)の短い記録(2026-11-21、本人「iPhone は特に白い画面になる」)。
 *
 * iPhone で白い画面になる時の様子は、こちらの手元(PC)では再現できない。その端末の中に、直近の動きを
 * 40行だけ残しておき、設定の「調査用の記録をコピー」で本人が貼り付けられるようにする。
 * 端末の外へは送らない(localStorage にだけ置く)。中身は時刻と出来事の名前だけで、個人の内容は入れない。
 */
export const LIFECYCLE_LOG_KEY = "lifehub:lifecycle-log";
const MAX_LINES = 40;

function stamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function logLifecycle(event: string, now: Date = new Date()): void {
  try {
    const list = readLifecycleLog();
    list.push(`${stamp(now)} ${event}`.slice(0, 300));
    window.localStorage.setItem(LIFECYCLE_LOG_KEY, JSON.stringify(list.slice(-MAX_LINES)));
  } catch {
    // 残せなくても、アプリの動きには関係ない
  }
}

export function readLifecycleLog(): string[] {
  try {
    const raw = window.localStorage.getItem(LIFECYCLE_LOG_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((line): line is string => typeof line === "string") : [];
  } catch {
    return [];
  }
}

/** iPhone・iPad(ホーム画面のアプリ・Safari)か。iPad は Mac と同じ名乗りをするので、指で触れるかで見分ける。 */
export function isIOSDevice(nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  if (!nav) return false;
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
  return nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1;
}

let installed = false;

/** 起動の時に1回だけ。裏に回った・戻った・ページが捨てられて戻った・拾えなかったエラーを記録する。 */
export function installLifecycleLogging(version: string): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
  logLifecycle(`起動 版=${version}${isIOSDevice() ? " iPhone" : ""}${standalone ? " ホーム画面" : ""} 画面=${window.location.pathname}`);
  document.addEventListener("visibilitychange", () => logLifecycle(document.visibilityState === "visible" ? "戻った" : "裏に回った"));
  window.addEventListener("pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted) logLifecycle("止められていた画面がそのまま戻った");
  });
  window.addEventListener("error", (event) => {
    const target = event.target as { src?: string; href?: string } | null;
    const what = event.message || target?.src || target?.href || "不明";
    logLifecycle(`エラー ${String(what).slice(0, 160)}`);
  }, true);
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: string } | undefined;
    logLifecycle(`処理されなかった失敗 ${String(reason?.message ?? event.reason).slice(0, 160)}`);
  });
}
