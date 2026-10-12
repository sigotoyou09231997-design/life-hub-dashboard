import { useEffect, useRef } from "react";

/**
 * 白＋青緑の上塗り（src/styles/theme-teal.css）の「動き」の部分。2026-10-12。
 *
 *  1. 金額や件数が、画面に入ったときに 0 から数え上がる（カウントアップ）
 *  2. ホームの黒いお金カードが、PC でマウスの位置に合わせて少し傾く
 *  3. カードの上を、マウスの位置に合わせた薄い光が追いかける（PC）
 *  4. 黒いカードに、現れたとき一度だけ光沢が流れる
 *  5. 下のナビで、選んでいる項目の後ろの青緑のつまみが滑って移る
 *
 * **見た目だけ**。データにも、ボタンを押したときの処理にも触らない。ページ側の JSX にも
 * 手を入れず、決まったクラス名の要素を後から見つけて CSS 変数とクラスを付けるだけ。
 *
 * カウントアップは React が描いた文字を一時的に書き換えるので、ぶつからないように:
 * - 毎フレーム「前に自分が書いた文字のままか」を確かめ、違っていたら（React が新しい値を
 *   書いたら）その場でやめて、React の値を残す。
 * - 終わったら必ず元の文字そのものに戻す（数え上げの途中の値を残さない）。
 */

const COUNT_SELECTOR = [
  ".warm-amount",
  ".warm-brief__count",
  ".finance-control-center > .finance-balance-module p.tabular-nums",
  ".lh-money__stats dd",
  ".lh-savings__amount",
  ".subs-total__amount",
  ".subs-total__stats dd",
].join(",");

const TILT_SELECTOR = ".lh-home > a.lh-money";
const SHEEN_SELECTOR = `${TILT_SELECTOR}, .finance-control-center > .finance-balance-module, .subs-total`;
const GLOW_SELECTOR = `.warm-card, .glass-card, ${SHEEN_SELECTOR}`;

const NUMBER_PATTERN = /\d{1,3}(?:,\d{3})+|\d+/g;
const COUNT_DURATION = 1100;

function easeOutExpo(t: number) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function formatLike(value: number, sample: string) {
  const rounded = Math.round(value);
  return sample.includes(",") ? rounded.toLocaleString("en-US") : String(rounded);
}

/** 文字の中の数字を、目標値の t 倍にした文字列を作る。 */
function textAt(original: string, t: number) {
  return original.replace(NUMBER_PATTERN, (match) => {
    const target = Number(match.replace(/,/g, ""));
    return formatLike(target * t, match);
  });
}

/** 数え上げてよい文字か。日付・時刻・分数（1/3）のようなものは数えない。 */
function countableText(text: string) {
  if (!/\d/.test(text)) return false;
  if (/[:/年月日]/.test(text)) return false;
  const numbers = text.match(NUMBER_PATTERN) ?? [];
  return numbers.length > 0 && numbers.length <= 2;
}

function countUp(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; original: string; written: string }[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    if (countableText(text)) nodes.push({ node: node as Text, original: text, written: text });
  }
  if (nodes.length === 0) return;

  element.classList.add("is-counting");
  const start = performance.now();
  const step = (now: number) => {
    const t = easeOutExpo(Math.min(1, (now - start) / COUNT_DURATION));
    let alive = false;
    nodes.forEach((entry) => {
      if (!entry.node.isConnected) return;
      // React が途中で新しい値を書いた → それを尊重して、この数字は止める。
      if (entry.node.nodeValue !== entry.written) return;
      entry.written = t >= 1 ? entry.original : textAt(entry.original, t);
      entry.node.nodeValue = entry.written;
      if (t < 1) alive = true;
    });
    if (alive) window.requestAnimationFrame(step);
    else element.classList.remove("is-counting");
  };
  // 最初のフレームで 0 にしてから数え始める。
  nodes.forEach((entry) => {
    entry.written = textAt(entry.original, 0);
    entry.node.nodeValue = entry.written;
  });
  window.requestAnimationFrame(step);
}

function replaySheen(element: HTMLElement) {
  element.classList.remove("is-sheen");
  void element.offsetWidth;
  element.classList.add("is-sheen");
}

/** 下のナビの、選んでいる項目の位置をつまみ（nav::before）に渡す。 */
function placeNavIndicator(instant: boolean) {
  document.querySelectorAll<HTMLElement>(".glass-nav nav").forEach((nav) => {
    const active = nav.querySelector<HTMLElement>("a.is-active");
    if (!active) {
      nav.style.setProperty("--ind-o", "0");
      return;
    }
    nav.classList.toggle("is-ind-instant", instant);
    nav.style.setProperty("--ind-x", `${active.offsetLeft}px`);
    nav.style.setProperty("--ind-y", `${active.offsetTop}px`);
    nav.style.setProperty("--ind-w", `${active.offsetWidth}px`);
    nav.style.setProperty("--ind-h", `${active.offsetHeight}px`);
    nav.style.setProperty("--ind-o", "1");
    if (instant) {
      window.requestAnimationFrame(() => nav.classList.remove("is-ind-instant"));
    }
  });
}

export function useDesignMotion(routeKey: string) {
  // 1・4. 画面に入った要素を数え上げる／光沢を流す（ページが変わるたびに数え直す）
  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const handled = new WeakSet<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          const element = entry.target as HTMLElement;
          if (element.matches(SHEEN_SELECTOR)) replaySheen(element);
          if (element.matches(COUNT_SELECTOR)) {
            // ページ全体のせり上がり（usePageMotion）と重ねて見せたいので、少しだけ遅らせる。
            window.setTimeout(() => countUp(element), 120);
          }
        });
      },
      { threshold: 0.4 },
    );

    let frame = 0;
    const scan = () => {
      frame = 0;
      document.querySelectorAll<HTMLElement>(`${COUNT_SELECTOR}, ${SHEEN_SELECTOR}`).forEach((element) => {
        if (handled.has(element)) return;
        handled.add(element);
        observer.observe(element);
      });
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(scan);
    };
    schedule();
    // 中身は Dexie から後で届くので、増えた分も拾う。
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutations.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [routeKey]);

  // 2・3. マウスに合わせた傾きと光（PC のみ）
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let glowCard: HTMLElement | null = null;
    let tiltCard: HTMLElement | null = null;
    let pending: PointerEvent | null = null;
    let frame = 0;

    const clearTilt = () => {
      if (!tiltCard) return;
      tiltCard.style.removeProperty("--tilt-x");
      tiltCard.style.removeProperty("--tilt-y");
      tiltCard = null;
    };
    const clearGlow = () => {
      if (!glowCard) return;
      glowCard.style.removeProperty("--mx");
      glowCard.style.removeProperty("--my");
      glowCard = null;
    };

    const apply = () => {
      frame = 0;
      const event = pending;
      pending = null;
      if (!event) return;
      const target = event.target instanceof Element ? event.target : null;

      const card = target?.closest<HTMLElement>(GLOW_SELECTOR) ?? null;
      if (card !== glowCard) {
        clearGlow();
        if (card && !glowCard) {
          glowCard = card;
          if (card.matches(SHEEN_SELECTOR)) replaySheen(card);
        }
      }
      if (glowCard) {
        const rect = glowCard.getBoundingClientRect();
        glowCard.style.setProperty("--mx", `${event.clientX - rect.left}px`);
        glowCard.style.setProperty("--my", `${event.clientY - rect.top}px`);
      }

      const tilt = target?.closest<HTMLElement>(TILT_SELECTOR) ?? null;
      if (tilt !== tiltCard) clearTilt();
      if (tilt) {
        tiltCard = tilt;
        const rect = tilt.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        tilt.style.setProperty("--tilt-x", `${(-y * 7).toFixed(2)}deg`);
        tilt.style.setProperty("--tilt-y", `${(x * 9).toFixed(2)}deg`);
      }
    };

    const handleMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pending = event;
      if (!frame) frame = window.requestAnimationFrame(apply);
    };
    const handleLeave = () => {
      clearTilt();
      clearGlow();
    };
    // 押した瞬間は傾きを戻す（押した先が別の画面へ移る時に、傾いたまま残らないように）。
    const handleDown = () => clearTilt();

    document.addEventListener("pointermove", handleMove, { passive: true });
    document.addEventListener("pointerdown", handleDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", handleLeave);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerdown", handleDown);
      document.documentElement.removeEventListener("pointerleave", handleLeave);
      if (frame) window.cancelAnimationFrame(frame);
      handleLeave();
    };
  }, []);

  // 5. 下のナビのつまみ。開いた直後だけは、左端から滑らせずにその場へ置く。
  const placedOnce = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const instant = !placedOnce.current;
    placedOnce.current = true;
    const frame = window.requestAnimationFrame(() => placeNavIndicator(instant));
    const handleResize = () => placeNavIndicator(true);
    window.addEventListener("resize", handleResize);
    // ナビの並び（ユーザーが選べる）や選択が変わったときにも置き直す。
    const nav = document.querySelector(".glass-nav nav");
    const mutations = new MutationObserver(() => placeNavIndicator(false));
    if (nav) mutations.observe(nav, { attributes: true, attributeFilter: ["class"], subtree: true, childList: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      mutations.disconnect();
    };
  }, [routeKey]);
}
