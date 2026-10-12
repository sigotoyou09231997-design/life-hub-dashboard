import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent } from "react";
import { moveTo } from "../lib/packingOrder";

/** 長押しと見なすまでの時間。これより前に指が動いたら、並べ替えではなく普通のスクロール。 */
export const LONG_PRESS_MS = 350;
const MOVE_TOLERANCE_PX = 8;

interface Drag {
  /** どの組の中で動かしているか(持ち物の種類・日程の日付)。組をまたいでは動かせない。 */
  group: string;
  pointerId: number;
  from: number;
  over: number;
}

/**
 * 長押しして指で上下に動かす並べ替え。持ち物と日程で同じ手触りにするため、1か所にまとめてある。
 *
 * 持ち物で作ったもの(2026-10-11、要望の受信箱「持ち物の順番を長押しスワイプで入れ替えられるようにして」)を、
 * 日程の行ごとの「↑」「↓」をやめた時(2026-10-12)にここへ切り出した。
 *
 * 長押しの前に指が動いたら普通のスクロールとして扱う。並べ替えている間だけ、画面のスクロールを止める
 * (止めないと、iOS はスクロールを始めて指の動きを横取りし、並べ替えが途中で切れる)。
 *
 * 長押しが決まった後の指の動きは、行ではなく画面全体(window)で追う。動かしている間は行の並びを
 * 入れ替えて見せるので、React が行の要素を DOM の中で動かす。すると行に付けた「指の捕まえ」
 * (setPointerCapture)が外れ、指が行と行のすき間や一覧の外へ出たとたん動きも「離した」も届かなくなって、
 * 並べ替えが途中で止まったままになっていた(2026-10-12、日程へ広げる時に Chromium のタッチで確かめた)。
 *
 * 使い方: 行の入れ物に containerRef を付け、各行に rowProps(組, いまの並びでの番号) を広げる。
 * 動かしている間は preview(組, 並び) で、落とす位置へ動かした並びを出す(指を離す前に、どこに入るか分かるように)。
 * 指を離すと onMove(組, from, to)。from と to が同じなら呼ばない。
 * 長押しを待たずに動かせる「つまみ」を出す時は、つまみに handleProps(組, 番号) を広げる。
 */
export function useLongPressReorder(onMove: (group: string, from: number, to: number) => void) {
  const [drag, setDragState] = useState<Drag | null>(null);
  // ポインタの出来事は描き直しを待たずに続けて届くので、いまの状態は ref にも置いて、そちらを読む。
  const dragRef = useRef<Drag | null>(null);
  const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** 並べ替えを終えた直後の「押した」(指を離した時に出るクリック)で、編集を開かないための印。 */
  const justDraggedRef = useRef(false);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  // 入れ物は、予定の無い日などで出たり消えたりする。付け直しを拾えるよう、ref ではなく state で持つ
  // (指を追う window の聞き手からは、いまの入れ物を ref で読む)。
  const [container, setContainerState] = useState<HTMLElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  /** 長押しが決まった後に window へ付けた聞き手を外す。並べ替えていない時は null。 */
  const stopFollowingRef = useRef<(() => void) | null>(null);

  // ref として要素に渡すので、毎回同じ関数にしておく(描くたびに変わると、付け外しが毎回起きる)。
  const setContainer = useCallback((el: HTMLElement | null) => {
    containerRef.current = el;
    setContainerState(el);
  }, []);

  function setDrag(next: Drag | null) {
    dragRef.current = next;
    setDragState(next);
  }

  // 並べ替えている間は、指の動きでページがスクロールしないようにする(passive: false で止める)。
  useEffect(() => {
    if (!container) return;
    const stop = (event: TouchEvent) => {
      if (dragRef.current) event.preventDefault();
    };
    container.addEventListener("touchmove", stop, { passive: false });
    return () => container.removeEventListener("touchmove", stop);
  }, [container]);

  useEffect(
    () => () => {
      if (pressRef.current) window.clearTimeout(pressRef.current.timer);
      stopFollowingRef.current?.();
    },
    [],
  );

  function cancelPress() {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>, group: string, index: number) {
    // 右クリックなど、主のボタン以外は並べ替えに使わない。並べ替えの最中に別の指が触れても、始め直さない。
    if (event.button > 0 || dragRef.current) return;
    cancelPress();
    const pointerId = event.pointerId;
    const timer = window.setTimeout(() => {
      pressRef.current = null;
      navigator.vibrate?.(15);
      setDrag({ group, pointerId, from: index, over: index });
      followPointer(pointerId);
    }, LONG_PRESS_MS);
    pressRef.current = { timer, x: event.clientX, y: event.clientY };
  }

  /** 長押しの前に指が動いたら、スクロールとして扱う(並べ替えにしない)。 */
  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const press = pressRef.current;
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE_PX) cancelPress();
  }

  /** 長押しが決まった後は、指が離れるまで window で追う(上の説明のとおり、行では取りこぼす)。 */
  function followPointer(pointerId: number) {
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId === pointerId) moveOver(event.clientY);
    };
    const up = (event: globalThis.PointerEvent) => {
      if (event.pointerId === pointerId) finish(true);
    };
    const cancel = (event: globalThis.PointerEvent) => {
      if (event.pointerId === pointerId) finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    stopFollowingRef.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      stopFollowingRef.current = null;
    };
  }

  function moveOver(clientY: number) {
    const current = dragRef.current;
    const el = containerRef.current;
    if (!current || !el) return;
    // 指の高さより上に真ん中がある行の数が、落とす位置(動かしている行そのものは数えない)。
    let over = 0;
    el.querySelectorAll<HTMLElement>("[data-reorder-row]").forEach((row) => {
      if (row.dataset.reorderRow !== current.group || row.dataset.dragging === "true") return;
      const rect = row.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) over += 1;
    });
    if (over !== current.over) setDrag({ ...current, over });
  }

  /** 指を離した(drop = true)か、端末に取り消された(false)。取り消しでは並びを変えない。 */
  function finish(drop: boolean) {
    stopFollowingRef.current?.();
    const current = dragRef.current;
    if (!current) return;
    setDrag(null);
    // 離した直後に届く「押した」(クリック)で、編集を開かないようにする。
    justDraggedRef.current = true;
    window.setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);
    if (drop && current.from !== current.over) onMoveRef.current(current.group, current.from, current.over);
  }

  /** 1行ぶんに付けるもの。index は、動かす前の並びでの番号。 */
  function rowProps(group: string, index: number) {
    return {
      "data-reorder-row": group,
      "data-dragging": drag?.group === group && drag.from === index ? "true" : undefined,
      onPointerDown: (event: PointerEvent<HTMLElement>) => handlePointerDown(event, group, index),
      onPointerMove: handlePointerMove,
      // 長押しになる前に離した・取り消された時は、待ちをやめるだけ(ふつうの「押した」として編集が開く)。
      onPointerUp: cancelPress,
      onPointerCancel: cancelPress,
      onClickCapture: (event: MouseEvent<HTMLElement>) => {
        if (justDraggedRef.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      // 長押しで出る端末のメニュー(Android)や、パソコンで画像・リンクを掴んで引きずる動きに、指を取られないように。
      // ふつうの右クリックのメニューは残す。
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        if (pressRef.current || dragRef.current) event.preventDefault();
      },
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if (pressRef.current || dragRef.current) event.preventDefault();
      },
    };
  }

  /**
   * 行の「つまみ」に付けるもの(日程の「並べ替え」を押した時だけ出す。TripScheduleList)。
   * つまみは押した瞬間から動かせる — 長押しを待つのは、行を押すと編集が開くのと区別するためで、
   * 並べ替えると決めて出したつまみでまで待たせる理由が無い(パソコンのマウスでは、長押し自体が思いつかない)。
   * 行に付けた rowProps はそのままでよい。内側のつまみの pointerdown が先に届いて動かし始めるので、
   * そのあと届く行の側は「並べ替えの最中」として何もしない(長押しの待ちも始めない)。
   */
  function handleProps(group: string, index: number) {
    return {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button > 0 || dragRef.current) return;
        cancelPress();
        // 押したまま動かした時に、文字の選択が始まらないように。
        event.preventDefault();
        setDrag({ group, pointerId: event.pointerId, from: index, over: index });
        followPointer(event.pointerId);
      },
    };
  }

  /** 動かしている最中なら、落とす位置へ動かした並び。そうでなければそのまま。 */
  function preview<T>(group: string, list: T[]): T[] {
    return drag && drag.group === group ? moveTo(list, drag.from, drag.over) : list;
  }

  /** いま動かしている行か(index は動かす前の並びでの番号)。 */
  function isDragging(group: string, index: number): boolean {
    return drag !== null && drag.group === group && drag.from === index;
  }

  return { containerRef: setContainer, rowProps, handleProps, preview, isDragging };
}
