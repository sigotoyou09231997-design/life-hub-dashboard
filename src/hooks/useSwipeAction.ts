import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { LucideIcon } from "lucide-react";
import {
  claimGesture,
  decideSwipeIntent,
  isPastSwipeThreshold,
  releaseGesture,
  releaseVelocity,
  startsAtScreenEdge,
  swipeOffset,
  swipeOutcome,
  type SwipeSide,
} from "../lib/gestures";
import { haptic } from "../lib/haptics";
import { prefersReducedMotion } from "../lib/reducedMotion";

/** 払った時に行の下に見える色。complete = 青緑(完了・既読)、later = 琥珀(明日へ)、danger = 赤(削除)。 */
export type SwipeTone = "complete" | "later" | "danger";

export interface SwipeAction {
  label: string;
  icon: LucideIcon;
  tone: SwipeTone;
  /**
   * 決まった後の行の動き。
   * - "leave": 払った向きへ抜けて、行の高さをたたんでから操作する(一覧から消える操作: 削除・既読・明日へ)。
   * - "return": 元の位置へ戻しながら操作する(その場で見た目が変わる操作: 完了は A-4 の演出に任せる)。
   */
  after: "leave" | "return";
  onCommit: () => unknown;
}

export interface SwipeActionConfig {
  /** 左へ払った時の操作。 */
  left?: SwipeAction;
  /** 右へ払った時の操作。 */
  right?: SwipeAction;
  disabled?: boolean;
}

export type SwipeState = "idle" | "dragging" | "settling" | "leaving";

interface SwipeView {
  state: SwipeState;
  side: SwipeSide | null;
  armed: boolean;
}

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  target: EventTarget | null;
  mode: "pending" | "drag";
  width: number;
  offset: number;
  samples: { x: number; t: number }[];
}

const IDLE: SwipeView = { state: "idle", side: null, armed: false };
/** 離して決まらなかった時に、元の位置へ戻る時間。 */
const SETTLE_MS = 240;
/** 決まった時に、行が横へ抜ける時間。 */
const LEAVE_MS = 200;
/** 抜けた後に、行の高さがたたまれる時間。 */
const COLLAPSE_MS = 200;
/** 操作のあとも行が残っていたら(既読にしても「重要」の一覧には残る等)、ここまで待ってから戻す。
 * すぐ戻すと、一覧から消える行が一瞬だけ戻って見える(データの変化が画面に届くのを待つ)。 */
const RESTORE_AFTER_MS = 450;
/** 払い終えた指を離した時に届く「押した」を捨てる間。 */
const CLICK_GUARD_MS = 400;
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/** 文字の入力欄を触って動かしている最中か(文字の選択やカーソルを動かす指を、払いと取り違えない)。 */
function isEditingText(target: EventTarget | null): boolean {
  const active = typeof document === "undefined" ? null : document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return false;
  return target instanceof Node && active.contains(target);
}

/**
 * 一覧の行を指で横へ払う操作(UI/UX 調査メモ 第4弾 A-3)。
 *
 * 長押しの並べ替え(src/hooks/useLongPressReorder.ts)と同じく pointer の出来事で指を追う。
 * - 指(touch)だけ。マウスとペンでは何もしない — パソコンは今までどおり行のボタンで操作する。
 *   ボタン・メニューはスワイプがあっても残す(読み上げや、払う操作が苦手な人の通り道)。
 * - 縦か横かは、指が GESTURE_SLOP_PX 動いた時の向きで決める(src/lib/gestures.ts)。縦なら何もせず
 *   画面のスクロールに任せる。行には touch-action: pan-y を付けるので(gestures.css)、縦の動きは
 *   ブラウザが受け持ち、横の動きだけが pointer の出来事として届く。
 * - 画面の左端 16px から触り始めた指は使わない(iPhone の「戻る」の払いに譲る)。
 * - 払い終えた後に届く「押した」(クリック)は捨てる。払っただけで編集やメールが開かないように。
 * - 長押しの並べ替えとは、指が動くか(払い)・止まっているか(長押し)で自然に分かれる。
 *   並べ替えは 8px 動いた時点で待ちをやめ、払いは 10px 動くまで始まらない。
 *
 * 行の位置は描き直しを待たずに style へ直接書く(指の動きごとに React で描き直すと、長い一覧で遅れる)。
 * React の状態に置くのは、下に出す色(どちらの向きか)と「離せば決まる」かの切り替わりだけ。
 */
export function useSwipeAction({ left, right, disabled = false }: SwipeActionConfig) {
  const [view, setViewState] = useState<SwipeView>(IDLE);
  const viewRef = useRef<SwipeView>(IDLE);
  const gestureRef = useRef<Gesture | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const rootElRef = useRef<HTMLDivElement | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const clickGuardUntilRef = useRef(0);
  /** 抜ける動きの途中で画面ごと消えた時に、操作だけは済ませるための控え。 */
  const pendingCommitRef = useRef<SwipeSide | null>(null);
  // 操作は描くたびに変わる(行の中身を閉じ込めている)。決まった時に最新のものを呼ぶよう ref に置く。
  const actionsRef = useRef({ left, right });
  actionsRef.current = { left, right };

  const rootRef = useCallback((el: HTMLDivElement | null) => {
    rootElRef.current = el;
    setRoot(el);
  }, []);

  function setView(next: SwipeView) {
    const current = viewRef.current;
    if (current.state === next.state && current.side === next.side && current.armed === next.armed) return;
    viewRef.current = next;
    setViewState(next);
  }

  function later(fn: () => void, ms: number) {
    timersRef.current.push(window.setTimeout(fn, ms));
  }

  function clearTimers() {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }

  /** 行を offset の位置へ。transition を渡すと、その動きで移る。 */
  function place(offset: number, transition?: string) {
    const surface = surfaceRef.current;
    const el = rootElRef.current;
    if (!surface || !el) return;
    surface.style.transition = transition ? `transform ${transition}` : "none";
    surface.style.transform = offset ? `translate3d(${offset}px, 0, 0)` : "";
    // 下の色の幅(gestures.css の --swipe-x)。行と同じ動きで広がる・縮むよう、同じ transition を付ける。
    el.style.setProperty("--swipe-x", `${Math.abs(offset)}px`);
    // "none" にしないのは、CSS 側でほかの transition と並べて書くため(none は単独でしか書けない)。
    el.style.setProperty("--swipe-transition", transition ? `width ${transition}` : "width 0s");
  }

  /** 行を元の見た目へ(高さ・透明度・位置)。 */
  function resetStyles() {
    const el = rootElRef.current;
    if (el) {
      el.style.transition = "";
      el.style.height = "";
      el.style.opacity = "";
      el.style.marginTop = "";
    }
    place(0);
  }

  function settle() {
    const reduce = prefersReducedMotion();
    place(0, reduce ? undefined : `${SETTLE_MS}ms ${SPRING}`);
    setView({ state: "settling", side: viewRef.current.side, armed: false });
    clearTimers();
    later(() => {
      place(0);
      setView(IDLE);
    }, reduce ? 0 : SETTLE_MS);
  }

  function runCommit(side: SwipeSide) {
    pendingCommitRef.current = null;
    try {
      void Promise.resolve(actionsRef.current[side]?.onCommit()).catch(() => undefined);
    } catch {
      // 操作の失敗は、それぞれの操作の側で知らせる(ここで止めると行が戻らなくなる)。
    }
  }

  function commit(side: SwipeSide, width: number) {
    const action = actionsRef.current[side];
    if (!action) return settle();
    haptic("light");
    const reduce = prefersReducedMotion();
    if (action.after === "return" || reduce) {
      // 戻しながら操作する。動きを減らす設定の時は、抜ける・たたむを飛ばしてすぐ操作する。
      settle();
      runCommit(side);
      return;
    }
    clearTimers();
    pendingCommitRef.current = side;
    setView({ state: "leaving", side, armed: true });
    const distance = (width > 0 ? width : 320) + 24;
    place(side === "right" ? distance : -distance, `${LEAVE_MS}ms ${EASE_OUT}`);
    later(() => {
      const el = rootElRef.current;
      if (!el) return;
      // 高さをいったん数字で書いてから 0 へ動かす(auto からは動かせないため)。
      el.style.height = `${el.offsetHeight}px`;
      void el.offsetHeight;
      el.style.transition = `height ${COLLAPSE_MS}ms ${EASE_OUT}, opacity ${COLLAPSE_MS}ms ease-out, margin-top ${COLLAPSE_MS}ms ${EASE_OUT}`;
      el.style.height = "0px";
      el.style.opacity = "0";
      el.style.marginTop = "0px";
    }, LEAVE_MS);
    later(() => {
      runCommit(side);
      // 操作のあとも行が残っていたら(消えない一覧だった)、元の位置へ戻す。
      later(() => {
        resetStyles();
        setView(IDLE);
        rootElRef.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
      }, RESTORE_AFTER_MS);
    }, LEAVE_MS + COLLAPSE_MS);
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

  // 画面ごと消えた時: 待ちを止め、札を返す。抜ける途中だった操作は、ここで済ませる
  // (払って消したのに、すぐ別の画面へ移ったら消えていなかった、にしないため)。
  useEffect(
    () => () => {
      clearTimers();
      if (gestureRef.current?.mode === "drag") releaseGesture("swipe");
      gestureRef.current = null;
      const pending = pendingCommitRef.current;
      if (pending) runCommit(pending);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const enabled = !disabled && Boolean(left || right);

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (!enabled || event.pointerType !== "touch" || !event.isPrimary) return;
    // 払っている最中・抜けている最中に触れた別の指は使わない。決まらないまま残った前の指の控えは捨てる。
    if (gestureRef.current?.mode === "drag" || viewRef.current.state === "leaving") return;
    if (startsAtScreenEdge(event.clientX)) return;
    const el = rootElRef.current;
    if (!el) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target: event.target,
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
      if (intent === "vertical" || isEditingText(gesture.target) || !claimGesture("swipe")) {
        gestureRef.current = null;
        return;
      }
      gesture.mode = "drag";
      clearTimers();
      // 行の角の丸みを、下の色にも写す(行ごとに丸みが違うため、描かれている値を読む)。
      const el = rootElRef.current;
      const first = surfaceRef.current?.firstElementChild;
      if (el && first) el.style.setProperty("--swipe-radius", getComputedStyle(first).borderTopLeftRadius || "14px");
      try {
        el?.setPointerCapture?.(event.pointerId);
      } catch {
        // 指がもう離れている等で捕まえられなくても、行の上にいる間は動く。
      }
    }
    const sides = { left: Boolean(actionsRef.current.left), right: Boolean(actionsRef.current.right) };
    const offset = swipeOffset(dx, sides);
    gesture.offset = offset;
    gesture.samples.push({ x: event.clientX, t: event.timeStamp });
    if (gesture.samples.length > 8) gesture.samples.shift();
    place(offset);
    const side: SwipeSide | null = offset > 0 && sides.right ? "right" : offset < 0 && sides.left ? "left" : null;
    setView({ state: "dragging", side, armed: side !== null && isPastSwipeThreshold(offset, gesture.width) });
  }

  function handlePointerUp(event: PointerEvent<HTMLElement>) {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gestureRef.current = null;
    if (gesture.mode !== "drag") return;
    releaseGesture("swipe");
    clickGuardUntilRef.current = Date.now() + CLICK_GUARD_MS;
    const sides = actionsRef.current;
    const outcome = swipeOutcome({
      offset: gesture.offset,
      width: gesture.width,
      velocity: releaseVelocity(gesture.samples),
      left: Boolean(sides.left),
      right: Boolean(sides.right),
    });
    if (outcome) commit(outcome, gesture.width);
    else settle();
  }

  /** 端末に指を取り上げられた(縦のスクロールが始まった等)。決めずに戻す。 */
  function handlePointerCancel(event: PointerEvent<HTMLElement>) {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gestureRef.current = null;
    if (gesture.mode !== "drag") return;
    releaseGesture("swipe");
    clickGuardUntilRef.current = Date.now() + CLICK_GUARD_MS;
    settle();
  }

  function handleClickCapture(event: MouseEvent<HTMLElement>) {
    if (Date.now() < clickGuardUntilRef.current || viewRef.current.state === "leaving") {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return {
    rootRef,
    surfaceRef,
    enabled,
    state: view.state,
    side: view.side,
    armed: view.armed,
    bind: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onClickCapture: handleClickCapture,
    },
  };
}
