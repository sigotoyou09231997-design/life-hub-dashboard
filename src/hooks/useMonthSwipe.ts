import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import {
  claimGesture,
  decideSwipeIntent,
  monthSwipeStep,
  releaseGesture,
  releaseVelocity,
  startsAtScreenEdge,
} from "../lib/gestures";
import { haptic } from "../lib/haptics";
import { prefersReducedMotion } from "../lib/reducedMotion";

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  mode: "pending" | "drag";
  width: number;
  offset: number;
  samples: { x: number; t: number }[];
}

/** 決まらなかった時に、マスが元の位置へ戻る時間。 */
const SETTLE_MS = 240;
/** 決まった時に、今の月のマスが払った向きへ抜ける時間。 */
const LEAVE_MS = 140;
/** 抜けたあと、次の月のマスが反対側から入ってくる時間。 */
const ENTER_MS = 220;
/** 抜ける・入ってくる時に動かす幅(マスの幅に対する割合)。全部の幅を動かすと、間が空いて見える。 */
const TRAVEL_RATIO = 0.35;
/** 払い終えた指を離した時に届く「押した」を捨てる間(useSwipeAction と同じ)。 */
const CLICK_GUARD_MS = 400;
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * 月のカレンダーを指で横へ払って、前の月・次の月へ動かす。
 *
 * 指の見分け方は一覧の行の払い(src/hooks/useSwipeAction.ts)と同じ:
 * - 指(touch)だけ。マウスとペンでは何もしない — パソコンは今までどおり ‹ › のボタンで動かす。
 * - 縦か横かは、指が GESTURE_SLOP_PX 動いた時の向きで決める。縦なら何もせず画面のスクロールに任せる
 *   (カレンダーには touch-action: pan-y を付けるので、縦の動きはブラウザが受け持つ。gestures.css)。
 * - 画面の左端 16px から触り始めた指は使わない(iPhone の「戻る」の払いに譲る)。
 * - 払い終えた後に届く「押した」は捨てる。払っただけで、指を離したマスの予定の追加・編集が開かないように。
 *
 * マスの位置は描き直しを待たずに style へ直接書く(指の動きごとに月全体を描き直すと遅れる)。
 * 決まったら、今の月が払った向きへ抜け、次の月が反対側から入ってくる。「視差効果を減らす」がオンなら、
 * 動きを飛ばしてすぐ月を変える。
 */
export function useMonthSwipe(onStep: (step: -1 | 1) => void, enabled = true) {
  const gestureRef = useRef<Gesture | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const rootElRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const clickGuardUntilRef = useRef(0);
  /** 抜ける・入ってくる動きの途中か(その間に触れた指は使わない)。 */
  const animatingRef = useRef(false);
  // 描くたびに変わる関数を、決まった時に最新のものを呼ぶよう ref に置く。
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const rootRef = useCallback((el: HTMLDivElement | null) => {
    rootElRef.current = el;
    setRoot(el);
  }, []);

  function later(fn: () => void, ms: number) {
    timersRef.current.push(window.setTimeout(fn, ms));
  }

  function clearTimers() {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }

  /** マスを offset の位置へ。transition を渡すと、その動きで移る。払った量に合わせて少し薄くする。 */
  function place(offset: number, width: number, transition?: string, opacity?: number) {
    const surface = surfaceRef.current;
    if (!surface) return;
    const fade = opacity ?? 1 - Math.min(0.35, (Math.abs(offset) / (width > 0 ? width : 320)) * 0.5);
    // 元の位置で止まっている時は、書いた style を全部外す(マスの見た目を CSS だけに戻す)。
    const resting = !transition && offset === 0 && fade >= 1;
    surface.style.transition = transition ? `transform ${transition}, opacity ${transition}` : resting ? "" : "none";
    surface.style.transform = offset ? `translate3d(${offset}px, 0, 0)` : "";
    surface.style.opacity = fade < 1 ? String(fade) : "";
  }

  function settle(width: number) {
    const reduce = prefersReducedMotion();
    place(0, width, reduce ? undefined : `${SETTLE_MS}ms ${SPRING}`);
    clearTimers();
    later(() => place(0, width), reduce ? 0 : SETTLE_MS);
  }

  function runStep(step: -1 | 1) {
    try {
      onStepRef.current(step);
    } catch {
      // 月を変えられなくても、マスは元の位置へ戻す(下の place で)。
    }
  }

  function commit(step: -1 | 1, width: number) {
    haptic("light");
    clearTimers();
    if (prefersReducedMotion()) {
      place(0, width);
      runStep(step);
      return;
    }
    animatingRef.current = true;
    // 次の月(+1)は左へ払ったので左へ抜け、右から入ってくる。前の月はその逆。
    const travel = (width > 0 ? width : 320) * TRAVEL_RATIO;
    const out = step === 1 ? -travel : travel;
    place(out, width, `${LEAVE_MS}ms ${EASE_OUT}`, 0);
    later(() => {
      // 次の月を描き終えてから入ってくる動きを始める(描く前に始めると、今の月がもう一度入ってくる)。
      flushSync(() => runStep(step));
      place(-out, width, undefined, 0);
      void surfaceRef.current?.offsetWidth;
      place(0, width, `${ENTER_MS}ms ${EASE_OUT}`, 1);
      later(() => {
        place(0, width);
        animatingRef.current = false;
      }, ENTER_MS);
    }, LEAVE_MS);
  }

  // 払っている間は、指の動きで画面がスクロールしないようにする(touch-action だけでは、
  // 斜めに動いた指でブラウザが縦のスクロールを始めることがある)。passive: false で止める。
  useEffect(() => {
    if (!root) return;
    const stop = (event: TouchEvent) => {
      if (gestureRef.current?.mode === "drag" && event.cancelable) event.preventDefault();
    };
    root.addEventListener("touchmove", stop, { passive: false });
    return () => root.removeEventListener("touchmove", stop);
  }, [root]);

  // 画面ごと消えた時: 待ちを止め、札を返す。
  useEffect(
    () => () => {
      clearTimers();
      if (gestureRef.current?.mode === "drag") releaseGesture("swipe");
      gestureRef.current = null;
    },
    [],
  );

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (!enabled || event.pointerType !== "touch" || !event.isPrimary) return;
    if (gestureRef.current?.mode === "drag" || animatingRef.current) return;
    if (startsAtScreenEdge(event.clientX)) return;
    const el = surfaceRef.current ?? rootElRef.current;
    if (!el) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      mode: "pending",
      width: el.getBoundingClientRect().width || el.offsetWidth,
      offset: 0,
      samples: [{ x: event.clientX, t: event.timeStamp }],
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (gesture.mode === "pending") {
      const intent = decideSwipeIntent(dx, dy);
      if (intent === "pending") return;
      if (intent === "vertical" || !claimGesture("swipe")) {
        gestureRef.current = null;
        return;
      }
      gesture.mode = "drag";
      clearTimers();
      try {
        rootElRef.current?.setPointerCapture?.(event.pointerId);
      } catch {
        // 指がもう離れている等で捕まえられなくても、カレンダーの上にいる間は動く。
      }
    }
    gesture.offset = dx;
    gesture.samples.push({ x: event.clientX, t: event.timeStamp });
    if (gesture.samples.length > 8) gesture.samples.shift();
    place(dx, gesture.width);
  }

  function handlePointerUp(event: PointerEvent<HTMLElement>) {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gestureRef.current = null;
    if (gesture.mode !== "drag") return;
    releaseGesture("swipe");
    clickGuardUntilRef.current = Date.now() + CLICK_GUARD_MS;
    const step = monthSwipeStep({
      offset: gesture.offset,
      width: gesture.width,
      velocity: releaseVelocity(gesture.samples),
    });
    if (step) commit(step, gesture.width);
    else settle(gesture.width);
  }

  /** 端末に指を取り上げられた(縦のスクロールが始まった等)。月は変えずに戻す。 */
  function handlePointerCancel(event: PointerEvent<HTMLElement>) {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gestureRef.current = null;
    if (gesture.mode !== "drag") return;
    releaseGesture("swipe");
    clickGuardUntilRef.current = Date.now() + CLICK_GUARD_MS;
    settle(gesture.width);
  }

  function handleClickCapture(event: MouseEvent<HTMLElement>) {
    if (Date.now() < clickGuardUntilRef.current || animatingRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return {
    rootRef,
    surfaceRef,
    rootProps: enabled
      ? {
          onPointerDown: handlePointerDown,
          onPointerMove: handlePointerMove,
          onPointerUp: handlePointerUp,
          onPointerCancel: handlePointerCancel,
          onClickCapture: handleClickCapture,
        }
      : {},
  };
}
