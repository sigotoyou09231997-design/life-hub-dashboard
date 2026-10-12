/**
 * 「今日の最後の1件」を終えた時だけ、進み具合の輪を一周させて小さく光らせる(UI/UX 調査メモ 第4弾 A-4)。
 * 光らせるのは1日1回だけ。何度も光ると「ごほうび」ではなくただの飾りになるため。
 *
 * 判定(このファイル)と、光らせる側(src/hooks/useTaskRingCelebration.ts)を分けてある。
 */

export interface TodayTaskCounts {
  /** 今日が期日のタスクの数(サブタスクは数えない。予定・タスクの「今日」の輪と同じ数え方)。 */
  total: number;
  /** そのうち完了の数。 */
  completed: number;
}

/** 最後に光らせた日(YYYY-MM-DD)の置き場。 */
export const RING_CELEBRATED_KEY = "lifehub.taskRingCelebrated";

/**
 * いまの変化で光らせるか。
 * - 直前に残りが1件以上あって、いま全部終わった時だけ(開いた時にもう全部終わっていた時は光らせない)。
 * - 完了の数が増えた時だけ(残りを「明日へ」送って0件になった・消した、では光らせない)。
 * - 今日もう光らせていれば光らせない。
 */
export function shouldCelebrateRing(
  prev: TodayTaskCounts | null,
  next: TodayTaskCounts,
  lastCelebratedDate: string | null,
  today: string,
): boolean {
  if (!prev || lastCelebratedDate === today) return false;
  const prevRemaining = prev.total - prev.completed;
  return prevRemaining > 0 && next.total > 0 && next.completed === next.total && next.completed > prev.completed;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 最後に光らせた日。読めない時(プライベートブラウズ・保存を止めている等)は null。 */
export function readRingCelebratedDate(store: Storage | null = storage()): string | null {
  try {
    return store?.getItem(RING_CELEBRATED_KEY) ?? null;
  } catch {
    return null;
  }
}

/** 今日光らせたことを覚える。書けない時は何もしない(その日にもう一度光るだけで、困ることは無い)。 */
export function markRingCelebrated(today: string, store: Storage | null = storage()): void {
  try {
    store?.setItem(RING_CELEBRATED_KEY, today);
  } catch {
    // 書けなくても動きは続ける。
  }
}
