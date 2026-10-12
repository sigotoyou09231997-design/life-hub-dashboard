/**
 * 短い振動(UI/UX 調査メモ 第4弾 A-6)。
 *
 * 振動の仕組み(Vibration API)があるのは Android だけ。iPhone の Safari とホーム画面のアプリには無く、
 * 呼んでも何も起きない — iPhone での手応えは、動き(行が払われて消える・チェックが跳ねる)で出す。
 * なので、呼ぶ側は端末を気にせず呼んでよい。
 *
 * 使う所: スワイプが決まった時(src/hooks/useSwipeAction.ts)、タスクを完了にした時
 * (src/components/tasks/TaskItem.tsx・ホームの「今日のタスク」)、長押しの並べ替えが始まった時
 * (src/hooks/useLongPressReorder.ts)。
 */

export type HapticKind = "light" | "success";

/** 振動の長さ(ミリ秒)。light は並べ替えで使っていた 15ms のまま。success は短く2回(「できた」の手応え)。 */
const PATTERNS: Record<HapticKind, number | number[]> = {
  light: 15,
  success: [12, 60, 18],
};

export function haptic(kind: HapticKind = "light"): void {
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // 画面を触る前(ユーザー操作の外)など、ブラウザが振動を許さない場面では何もしない。
  }
}
