import { useEffect, useRef } from "react";

/** HOMEと同じく、スクロールする器は画面幅で変わる(>=1024pxは`.app-main`が内側で
 *  スクロールし、それ未満はwindow)。決め打ちせず実際に探す。 */
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

/** ページの中で「一枚の面」として現れるべきブロック。HOMEのタイルに相当する。 */
const BLOCK_SELECTOR = [
  ".spatial-page-header",
  ".spatial-tabs",
  ".glass-card",
  ".spatial-module",
  ".note-widget",
  ".notes-toolbar",
  ".notes-empty-control",
  ".destination-empty-control",
  ".planning-timeline-module",
  ".planning-task-module",
  ".planning-secondary-module",
  ".planning-list-module",
  ".calendar-workspace__detail",
  ".finance-balance-module",
  ".finance-summary-module",
  ".finance-metric-module",
  ".trip-overview-module",
  ".trip-detail-hero",
  ".mail-inbox-workspace",
  ".finance-ledger-workspace",
  ".glass-row",
  ".spatial-control",
  ".empty-state",
  ".app-button",
  "[data-page-block]",
].join(",");

/** 前面に出る面と、位置が固定されているものは動かさない。 */
const EXCLUDE_SELECTOR = [
  ".spatial-sheet",
  ".spatial-sheet-backdrop",
  ".glass-modal",
  ".app-header",
  ".glass-nav",
  ".desktop-sidebar",
  ".hub-home",
].join(",");

function collectBlocks(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  return all.filter((element) => {
    if (element.closest(EXCLUDE_SELECTOR)) return false;
    if (window.getComputedStyle(element).position === "fixed") return false;
    // 入れ子は外側だけを動かす。カードの中の行まで個別に動くと、面が割れて見える。
    const parentBlock = element.parentElement?.closest<HTMLElement>(BLOCK_SELECTOR);
    return !(parentBlock && parentBlock !== element && root.contains(parentBlock));
  });
}

/**
 * HOMEにしか無かった2つのスクロール連動を、残りの全ページにも与える。
 *
 *  1. `--hub-scroll` … ページタイトルが写真ごと奥へ引くための生のスクロール量
 *  2. `.is-page-reveal` … ブロックが順にせり上がって現れる一度きりの出現
 *
 * ページ側のJSXには一切触らない。ルートが変わるたびに面を数え直すので、今後
 * 増える画面も自動で同じ作法に乗る。HOME(`.hub-home`)は自前で useHubMotion を
 * 持っているので、ここでは何もしない。
 *
 * 出現の見た目は index.css の `.is-page-reveal` が持つ。HOMEの `[data-reveal]` を
 * そのまま借りないのは、既存画面の要素には別の由来で `.is-revealed` が残っている
 * ものがあり、借りると `[data-reveal].is-revealed` の方が強く当たって出現前の
 * 状態(opacity:0)が一度も適用されない — つまり一瞬で終わってしまうため。
 *
 * 出現し終えた要素からはクラスを外す。出現前の状態は transform と filter を持って
 * おり、これが残っていると position:fixed の子(シート)の基準点がこの要素になって
 * しまうため — `.page-transition` で同じ罠を踏んだのと同じ理由(index.cssの
 * page-enterのコメント参照)。
 */
export function usePageMotion<T extends HTMLElement>(routeKey: string) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (root.querySelector(".hub-home")) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    const handleResize = () => {
      const next = findScroller(root);
      if (next === scroller) return;
      detach();
      scroller = next;
      attach();
    };
    attach();
    window.addEventListener("resize", handleResize);

    const cleanups: (() => void)[] = [
      () => {
        detach();
        window.removeEventListener("resize", handleResize);
        if (frame) window.cancelAnimationFrame(frame);
      },
    ];

    if (!reduceMotion) {
      const settle = (element: HTMLElement) => {
        element.style.transitionDelay = "";
        element.classList.remove("is-page-reveal", "is-page-reveal-in");
      };

      const timers = new Set<number>();
      const reveal = (element: HTMLElement, delayIndex: number) => {
        const delay = Math.min(delayIndex, 5) * 55;
        element.style.transitionDelay = `${delay}ms`;
        element.classList.add("is-page-reveal-in");
        const done = () => {
          element.removeEventListener("transitionend", done);
          settle(element);
        };
        element.addEventListener("transitionend", done);
        // transitionend は子要素からも上がってくるし、要素が途中で外れると来ない。
        // 後始末(transform/filterを残さない)は必ず走らせたいので時間でも保証する。
        timers.add(window.setTimeout(done, delay + 900));
      };

      const observer = new IntersectionObserver(
        (entries) => {
          entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) =>
              a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
            )
            .forEach((entry, index) => {
              observer.unobserve(entry.target);
              reveal(entry.target as HTMLElement, index);
            });
        },
        { threshold: 0.02, rootMargin: "0px 0px -4% 0px" },
      );

      // ページ本体は遅延ロード、中身はDexieのライブクエリで後から届く。1回数えて
      // 終わりにすると、直リンクで開いたときにまだ何も無い瞬間を数えてしまい、
      // その画面だけ動かない。DOMが増えるたびに数え直し、まだ触っていない面だけを
      // 対象にする(処理済みは WeakSet で覚える)。あとから増える行 — 習慣を1つ
      // 追加した直後の行など — も同じ出方で現れる。
      const handled = new WeakSet<HTMLElement>();
      let blocks: HTMLElement[] = [];
      let sweepFrame = 0;
      const sweep = () => {
        sweepFrame = 0;
        const fresh = collectBlocks(root).filter((element) => !handled.has(element));
        if (fresh.length === 0) return;
        fresh.forEach((element) => {
          handled.add(element);
          element.classList.add("is-page-reveal");
        });
        blocks = blocks.filter((element) => element.isConnected).concat(fresh);
        // クラスを付けた直後に観測を始めると、初期値(opacity:0)でのスタイル計算を
        // 挟まないまま出現後の状態が乗り、トランジションが走らずに一瞬で終わる。
        // レイアウトを1回強制的に確定させてから観測する。
        void root.offsetHeight;
        fresh.forEach((element) => observer.observe(element));
      };
      const scheduleSweep = () => {
        if (sweepFrame) return;
        sweepFrame = window.requestAnimationFrame(sweep);
      };

      scheduleSweep();
      const mutations = new MutationObserver(scheduleSweep);
      mutations.observe(root, { childList: true, subtree: true });

      // 何かの理由で交差が発火しなかったときに中身が消えたままにならないための保険。
      const failsafe = window.setInterval(() => {
        blocks.forEach((element) => {
          if (!element.isConnected) settle(element);
        });
      }, 2000);

      cleanups.push(() => {
        timers.forEach((id) => window.clearTimeout(id));
        observer.disconnect();
        mutations.disconnect();
        if (sweepFrame) window.cancelAnimationFrame(sweepFrame);
        window.clearInterval(failsafe);
        blocks.forEach(settle);
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, [routeKey]);

  return ref;
}
