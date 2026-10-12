import { useCallback, useEffect, useRef, useState } from "react";
import {
  claimGesture,
  decidePullIntent,
  PULL_THRESHOLD_PX,
  pullDistance,
  releaseGesture,
} from "../lib/gestures";
import { haptic } from "../lib/haptics";

export type PullPhase = "idle" | "pulling" | "armed" | "refreshing";

/** 同期がすぐ終わっても、くるくるはこれだけ見せる(一瞬で消えると「何も起きなかった」に見える)。 */
const MIN_REFRESH_MS = 500;

/**
 * 指が触れた所から上へたどって、スクロールしている入れ物がどれも一番上にいるか。
 * スマホは画面全体(window)が、PC幅(タブレットの横向きなど)は .app-main やメール一覧の中が
 * スクロールするので、どれか1つでも下へずれていれば引っ張りにしない(ふつうのスクロールに任せる)。
 */
export function isScrolledToTop(target: Element | null): boolean {
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (el.scrollTop > 0) return false;
  }
  const page = typeof document === "undefined" ? null : (document.scrollingElement ?? document.documentElement);
  if (page && page.scrollTop > 0) return false;
  return typeof window === "undefined" || window.scrollY <= 0;
}

/**
 * 画面を下へ引っ張って同期する(UI/UX 調査メモ 第4弾 A-7)。Gmail の一覧と、予定・タスクで使う。
 *
 * - 指(touch の出来事)だけ。マウスでは何も起きない — パソコンは今までどおり「今すぐ同期」のボタン。
 * - スクロールしている入れ物が一番上にいる時だけ。少しでも下にいれば、ふつうのスクロールのまま。
 * - 下へ引いた時だけ引っ張りにする。横の払い(行のスワイプ・絞り込みのチップ)と上へのスクロールは、
 *   指が 10px 動いた時の向きで見分けて手を出さない(src/lib/gestures.ts)。
 * - 引っ張っている間は、画面のスクロール(iPhone のゴムのような伸び・Android の Chrome の
 *   「引っ張って再読み込み」)を止めて、こちらの目印だけを動かす。両方が同時に動くと、
 *   画面が伸びながら目印も下りてきて、どちらが同期なのか分からなくなるため。
 *   一番上でない時や、上へのスクロールには一切手を出さない。
 * - シート(下から出る画面)の中の指は使わない。シートは同じ画面の中に描かれているので、
 *   そのままだとシートの一番上で引いた指でも同期が走ってしまう。
 *
 * 引っ張りの量は描き直しを待たずに目印の style へ直接書く。React の状態に置くのは段階だけ。
 */
export function usePullToRefresh(onRefresh: () => unknown, { disabled = false }: { disabled?: boolean } = {}) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhaseState] = useState<PullPhase>("idle");
  const phaseRef = useRef<PullPhase>("idle");
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const mountedRef = useRef(true);

  const containerRef = useCallback((el: HTMLElement | null) => setContainer(el), []);

  function setPhase(next: PullPhase) {
    if (phaseRef.current === next) return;
    phaseRef.current = next;
    // 目印の段階は描き直しを待たずに書く。離した瞬間の「同期の位置へ戻る」動き(gestures.css の
    // transition)は段階で切り替えているので、描き直しが後になると、その一瞬だけ動きなしで跳ぶ。
    if (indicatorRef.current) indicatorRef.current.dataset.phase = next;
    setPhaseState(next);
  }

  function show(distance: number) {
    const el = indicatorRef.current;
    if (!el) return;
    el.style.setProperty("--pull", `${distance}px`);
    el.style.setProperty("--pull-progress", String(Math.min(1, distance / PULL_THRESHOLD_PX)));
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!container || disabled) return;
    let start: { x: number; y: number; id: number } | null = null;
    let mode: "pending" | "pull" | "ignore" = "ignore";
    let distance = 0;

    async function refresh() {
      setPhase("refreshing");
      show(PULL_THRESHOLD_PX);
      const startedAt = Date.now();
      try {
        await onRefreshRef.current();
      } catch {
        // 失敗の知らせは同期の側(トースト)が出す。ここでは目印を戻すだけ。
      } finally {
        const wait = Math.max(0, MIN_REFRESH_MS - (Date.now() - startedAt));
        window.setTimeout(() => {
          if (!mountedRef.current) return;
          setPhase("idle");
          show(0);
        }, wait);
      }
    }

    function finish(release: boolean) {
      const pulled = mode === "pull";
      if (pulled) releaseGesture("pull");
      start = null;
      mode = "ignore";
      if (!pulled) return;
      if (release && distance >= PULL_THRESHOLD_PX) {
        void refresh();
      } else {
        setPhase("idle");
        show(0);
      }
      distance = 0;
    }

    const handleStart = (event: TouchEvent) => {
      start = null;
      mode = "ignore";
      if (phaseRef.current === "refreshing" || event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('[role="dialog"]') || !isScrolledToTop(target)) return;
      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
      mode = "pending";
      distance = 0;
    };

    const handleMove = (event: TouchEvent) => {
      if (!start || mode === "ignore") return;
      const touch = Array.from(event.touches).find((t) => t.identifier === start!.id);
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (mode === "pending") {
        const intent = decidePullIntent(dx, dy);
        if (intent === "pending") {
          // まだ向きが決まる前でも、下向きの指はここで止める。最初の動きを見送ると、Android の Chrome は
          // その指の間ずっと「再読み込み」の伸びを優先し、あとから止められなくなる。
          // 一番上で下へ引く動きなので、止めても動かなくなるスクロールは無い。
          if (dy > 0 && dy >= Math.abs(dx) && event.cancelable) event.preventDefault();
          return;
        }
        if (intent === "ignore" || !claimGesture("pull")) {
          mode = "ignore";
          return;
        }
        mode = "pull";
      }
      if (event.cancelable) event.preventDefault();
      const nextDistance = pullDistance(dy);
      // 「離せば同期する」所を越えた瞬間だけ、Android では短く振動させる(A-6)。
      if (distance < PULL_THRESHOLD_PX && nextDistance >= PULL_THRESHOLD_PX) haptic("light");
      distance = nextDistance;
      show(distance);
      setPhase(distance >= PULL_THRESHOLD_PX ? "armed" : "pulling");
    };

    const handleEnd = () => finish(true);
    const handleCancel = () => finish(false);

    container.addEventListener("touchstart", handleStart, { passive: true });
    container.addEventListener("touchmove", handleMove, { passive: false });
    container.addEventListener("touchend", handleEnd);
    container.addEventListener("touchcancel", handleCancel);
    return () => {
      container.removeEventListener("touchstart", handleStart);
      container.removeEventListener("touchmove", handleMove);
      container.removeEventListener("touchend", handleEnd);
      container.removeEventListener("touchcancel", handleCancel);
      if (mode === "pull") releaseGesture("pull");
      if (phaseRef.current !== "refreshing") {
        setPhase("idle");
        show(0);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, disabled]);

  return { containerRef, indicatorRef, phase };
}
