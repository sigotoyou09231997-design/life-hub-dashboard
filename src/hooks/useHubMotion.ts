import { useEffect, useRef } from "react";

/** The scroll container differs by breakpoint: at >=1024px `.app-main` scrolls
 *  internally, below that the window does. Detect it rather than assuming. */
function findScroller(element: HTMLElement): HTMLElement | Window {
  let node = element.parentElement;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return window;
}

function scrollTop(scroller: HTMLElement | Window): number {
  return scroller instanceof Window ? window.scrollY : scroller.scrollTop;
}

/**
 * Drives the two scroll-coupled effects of the Liquid Glass home screen:
 * a `--hub-scroll` custom property (raw pixel offset, unitless) that the hero
 * parallax reads, and a one-shot reveal class on every `[data-reveal]` child.
 *
 * Both collapse to their end state under `prefers-reduced-motion`.
 */
export function useHubMotion<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));

    if (reduceMotion) {
      targets.forEach((element) => element.classList.add("is-revealed"));
      // 後から現れる面(下記)も、動きを減らす設定では即座に見えるようにする。
      const revealLater = new MutationObserver(() => {
        root.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-revealed)").forEach((element) =>
          element.classList.add("is-revealed"),
        );
      });
      revealLater.observe(root, { childList: true, subtree: true });
      return () => revealLater.disconnect();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const element = entry.target as HTMLElement;
          // Stagger only within a batch that appears together, capped so a long
          // list never leaves the last card visibly lagging behind.
          const index = Number(element.dataset.reveal) || 0;
          element.style.transitionDelay = `${Math.min(index, 5) * 65}ms`;
          element.classList.add("is-revealed");
          observer.unobserve(element);
        });
      },
      { threshold: 0.05, rootMargin: "0px 0px -6% 0px" },
    );
    targets.forEach((element) => observer.observe(element));

    // 後から現れる面も見張る。ここは mount 時に1回 querySelectorAll するだけだったので、
    // 「データが届いてから初めて出てくるカード」(ホームPC幅の『今週これから』など)は
    // 一度も観測されず、opacity:0 のまま DOM にあるのに見えない状態で残っていた
    // (2026-09-07に実際に踏んだ)。下の保険も targets しか見ないので効かない。
    const added = new MutationObserver(() => {
      root.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-revealed)").forEach((element) => {
        if (targets.includes(element)) return;
        targets.push(element);
        observer.observe(element);
      });
    });
    added.observe(root, { childList: true, subtree: true });

    // 交差が一度も発火しなかったときの保険。HOMEは9枚中6枚が opacity:0 から
    // 始まるので、発火しないと画面が真っ白なまま残る。usePageMotion と同じ
    // 考え方で、まだ現れていないものを一定間隔で見に行き、すでに見えている
    // (＝観測が取りこぼした)ものを開ける。全部出たら自分で止まる。
    const failsafe = window.setInterval(() => {
      const pending = targets.filter((element) => !element.classList.contains("is-revealed"));
      if (pending.length === 0) {
        window.clearInterval(failsafe);
        return;
      }
      pending.forEach((element) => {
        // 画面から外れたままのものまで開けると出現が台無しになるので、
        // 「いま視界にある／すでに通り過ぎた」ものだけを対象にする。
        const rect = element.getBoundingClientRect();
        if (rect.top > window.innerHeight) return;
        element.classList.add("is-revealed");
        observer.unobserve(element);
      });
    }, 2000);

    let scroller = findScroller(root);
    let frame = 0;
    const applyScroll = () => {
      frame = 0;
      root.style.setProperty("--hub-scroll", String(scrollTop(scroller)));
    };
    const handleScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(applyScroll);
    };

    const attach = () => {
      scroller.addEventListener("scroll", handleScroll, { passive: true });
      applyScroll();
    };
    const detach = () => scroller.removeEventListener("scroll", handleScroll);

    // Crossing the 1024px breakpoint swaps which element scrolls.
    const handleResize = () => {
      const next = findScroller(root);
      if (next === scroller) return;
      detach();
      scroller = next;
      attach();
    };

    attach();
    window.addEventListener("resize", handleResize);

    return () => {
      window.clearInterval(failsafe);
      added.disconnect();
      observer.disconnect();
      detach();
      window.removeEventListener("resize", handleResize);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return ref;
}
