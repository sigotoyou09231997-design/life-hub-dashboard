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
      return;
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
      observer.disconnect();
      detach();
      window.removeEventListener("resize", handleResize);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return ref;
}
