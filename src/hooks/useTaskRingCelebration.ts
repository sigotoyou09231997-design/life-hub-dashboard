import { useEffect, useRef, useState } from "react";
import { markRingCelebrated, readRingCelebratedDate, shouldCelebrateRing } from "../lib/taskCelebration";
import { prefersReducedMotion } from "../lib/reducedMotion";

/** 輪が光っている時間(gestures.css の task-ring-glow と同じ長さ)。 */
const CELEBRATE_MS = 1400;

/**
 * 予定・タスクの「今日」の輪(TodayView)を、今日の最後の1件を終えた時だけ一周させて光らせる
 * (UI/UX 調査メモ 第4弾 A-4)。光らせるかの判定は src/lib/taskCelebration.ts。
 *
 * 前の描画の数と比べて「残りがあった → 0件になった」時だけ光る。開いた時点でもう全部終わっていた
 * 日には光らない(最初の描画は比べる相手が無いので見送る)。
 * 動きを減らす設定の時は光らせないが、その日の1回は使ったことにする(設定を戻した直後に光らないように)。
 */
export function useTaskRingCelebration(total: number, completed: number, today: string): boolean {
  const prevRef = useRef<{ total: number; completed: number } | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const prev = prevRef.current;
    const next = { total, completed };
    prevRef.current = next;
    if (!shouldCelebrateRing(prev, next, readRingCelebratedDate(), today)) return;
    markRingCelebrated(today);
    if (prefersReducedMotion()) return;
    setCelebrating(true);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCelebrating(false), CELEBRATE_MS);
  }, [total, completed, today]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return celebrating;
}
