/**
 * 日程とルートの連動(2026-10-14、要望「日程とルートが連動してほしい」→「全部やって」)を、旅行ごとに入り切りする印。
 * この端末の中に覚える(旅行ごと)。印が無ければ、入(連動する)。切ると、日程を直す・足す・消すことが、ルートに触らなくなる
 * (ルートを直すことが日程に触らなくもなる)。画面は、ルートのタブの「日程と連動する」。
 */
const KEY_PREFIX = "lifeHubRouteLink:";

export function isRouteLinked(tripId: string): boolean {
  try {
    return window.localStorage.getItem(`${KEY_PREFIX}${tripId}`) !== "0";
  } catch {
    return true;
  }
}

export function setRouteLinked(tripId: string, linked: boolean): void {
  try {
    window.localStorage.setItem(`${KEY_PREFIX}${tripId}`, linked ? "1" : "0");
  } catch {
    // 覚えられない環境では、この画面を開いている間だけ効く。
  }
}
