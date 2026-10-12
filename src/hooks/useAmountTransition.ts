import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { amountDelta, tweenAmount, type AmountSnapshot } from "../lib/amountDelta";

/** 差額が浮かんで見えている時間。CSS の num-delta-float(numbers-empty.css)と同じ長さ。 */
export const DELTA_FLOAT_MS = 1300;
/** 浮かんだ差額が合計に「入る」頃に、合計を数え始める。 */
const COUNT_DELAY_MS = 480;
const COUNT_DURATION_MS = 780;

export interface FloatingDelta {
  /** 続けて記録した時に、浮かぶ文字を毎回出し直すための番号。 */
  id: number;
  amount: number;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/** その要素がいま画面に見えているか。見ていない所で動かしても意味が無いので、その時は値だけ替える。 */
function isOnScreen(element: HTMLElement | null) {
  if (!element || typeof window === "undefined") return false;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
}

/**
 * 金額が変わった時に、前の値から新しい値へ数え上げる(UI/UX 調査メモ 第4弾 A-5)。
 *
 * 開いた直後の 0 → 合計 の数え上げは今までどおり useDesignMotion.ts に任せ、ここは
 * **開いたあとで値が変わった時だけ** 動く(ホームの「＋」で支出を入れて、シートが閉じた時など)。
 * 前に描いた値は ref に持ち、差があればその差額を浮かべてから、前の値 → 新しい値 へ数える。
 *
 * - 画面に見えていない・「視差効果を減らす」がオン → 浮かべずに、値だけその場で替える。
 * - 数えている途中にまた変わったら、いま見えている値から新しい値へ数え直す。
 * - 描く前(useLayoutEffect)に古い値へ戻すので、新しい値が一瞬ちらつくことはない。
 */
export function useAmountTransition(
  value: number | undefined,
  elementRef: RefObject<HTMLElement | null>,
  resetKey?: string,
): { display: number | undefined; delta: FloatingDelta | null } {
  const [tweening, setTweening] = useState<number | null>(null);
  const [delta, setDelta] = useState<FloatingDelta | null>(null);
  const lastRef = useRef<AmountSnapshot | undefined>(undefined);
  /** 数えている途中に見えている値。数えていない時は null。 */
  const tweenRef = useRef<number | null>(null);
  const sequence = useRef(0);
  const floatTimer = useRef<number | undefined>(undefined);

  const setTween = (next: number | null) => {
    tweenRef.current = next;
    setTweening(next);
  };

  useLayoutEffect(() => {
    const prev = lastRef.current;
    const next: AmountSnapshot = { value, key: resetKey };
    lastRef.current = next;
    const change = amountDelta(prev, next);
    if (change === 0 || value === undefined || prefersReducedMotion() || !isOnScreen(elementRef.current)) {
      setTween(null);
      return;
    }

    // 前の値から数える。数えている途中でまた変わった時は、いま見えている途中の値から数え直す。
    const from = tweenRef.current ?? prev?.value ?? value;
    setTween(from);
    sequence.current += 1;
    setDelta({ id: sequence.current, amount: change });
    window.clearTimeout(floatTimer.current);
    floatTimer.current = window.setTimeout(() => setDelta(null), DELTA_FLOAT_MS);

    let frame = 0;
    const start = performance.now() + COUNT_DELAY_MS;
    const step = (now: number) => {
      const t = (now - start) / COUNT_DURATION_MS;
      if (t >= 1) {
        setTween(null);
        return;
      }
      setTween(tweenAmount(from, value, Math.max(0, t)));
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
    // elementRef は ref なので依存に入れない(中身が替わっても描き直しは要らない)。
  }, [value, resetKey]);

  useEffect(() => () => window.clearTimeout(floatTimer.current), []);

  return { display: tweening ?? value, delta };
}
