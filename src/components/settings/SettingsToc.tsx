import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/* 設定の画面は、カードが縦に長く並んでいて目当ての所が探しにくい(UI/UX 調査メモ P-7)。
   PC(lg 以上)だけ、左に目次を置いて区切りへ飛べるようにする。スマホは今までどおり縦に
   並べるだけ(目次も区切りの見出しも出さない — 区切りは display: contents で箱を持たない)。 */

export interface SettingsTocItem {
  /** 区切り(SettingsSection)の id。目次から飛ぶ先。 */
  id: string;
  label: string;
  icon: LucideIcon;
}

/** 区切りの上端がここ(スクロールする枠の上端からの距離)より上に来たら「いま見ている」とみなす。
 * 飛んだ直後の位置(scroll-mt-6 = 24px)より大きく、2つ目の区切りが半分も見えていない所。 */
const ACTIVE_LINE_PX = 96;

/** いま見ている区切りを決める。上端が基準線より上に来た区切りのうち、いちばん下のもの。
 * どれも来ていなければ先頭。一番下までスクロールしきったときは最後の区切り — 背の低い区切りは
 * 基準線まで上がって来られず、いつまでも印が付かないため。`sections` は画面の上から順に渡す。 */
export function pickActiveSection(
  sections: readonly { id: string; top: number }[],
  activeLine: number,
  atBottom: boolean,
): string | null {
  if (sections.length === 0) return null;
  if (atBottom) return sections[sections.length - 1].id;
  let active = sections[0].id;
  for (const section of sections) {
    if (section.top > activeLine) break;
    active = section.id;
  }
  return active;
}

/** スクロールしている枠。PC では画面全体ではなく .app-main が縦にスクロールする(index.css)。 */
function scrollParentOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

export function SettingsToc({ items }: { items: SettingsTocItem[] }) {
  const navRef = useRef<HTMLElement>(null);
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  // 目次を押して飛んでいる途中は、通り過ぎる区切りに印が移ってちらつかないよう、測るのを止める。
  // スクロールが止まって少ししたら外す。
  const jumpLock = useRef<number | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const idsKey = items.map((item) => item.id).join(" ");

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const scroller = scrollParentOf(nav);
    let frame = 0;

    function measure() {
      frame = 0;
      if (jumpLock.current !== null) return;
      // スマホでは目次ごと隠れていて、区切りも箱を持たない(位置がすべて0になる)ので測らない。
      if (!nav || nav.getClientRects().length === 0) return;
      const frameTop = scroller ? scroller.getBoundingClientRect().top : 0;
      const sections = itemsRef.current.flatMap((item) => {
        const element = document.getElementById(item.id);
        return element ? [{ id: item.id, top: element.getBoundingClientRect().top - frameTop }] : [];
      });
      const box = scroller ?? document.scrollingElement ?? document.documentElement;
      const atBottom = box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
      const next = pickActiveSection(sections, ACTIVE_LINE_PX, atBottom);
      if (next) setActiveId(next);
    }

    function onScroll() {
      if (jumpLock.current !== null) {
        window.clearTimeout(jumpLock.current);
        jumpLock.current = window.setTimeout(() => {
          jumpLock.current = null;
        }, 160);
        return;
      }
      if (!frame) frame = window.requestAnimationFrame(measure);
    }

    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    measure();
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [idsKey]);

  useEffect(
    () => () => {
      if (jumpLock.current !== null) window.clearTimeout(jumpLock.current);
    },
    [],
  );

  function jumpTo(event: MouseEvent<HTMLAnchorElement>, id: string) {
    // 素のリンクのままだと URL に #… が付き、戻るボタンの履歴が増える。
    event.preventDefault();
    const section = document.getElementById(id);
    if (!section) return;
    setActiveId(id);
    if (jumpLock.current !== null) window.clearTimeout(jumpLock.current);
    // 既にその位置にいてスクロールが起きない時も、ずっと止めたままにしない。
    jumpLock.current = window.setTimeout(() => {
      jumpLock.current = null;
    }, 1000);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    // キーボードで押した人の次の Tab が、飛んだ先の中から始まるようにする。
    section.focus({ preventScroll: true });
  }

  return (
    <nav ref={navRef} aria-label="設定の目次" className="hidden lg:sticky lg:top-6 lg:block lg:self-start">
      <p className="mb-2 px-3 text-xs font-semibold text-[var(--warm-ink-3)]">目次</p>
      <ul className="flex flex-col gap-1">
        {items.map(({ id, label, icon: Icon }) => {
          const active = id === activeId;
          return (
            <li key={id}>
              <a
                href={`#${id}`}
                onClick={(event) => jumpTo(event, id)}
                aria-current={active ? "location" : undefined}
                className={`flex min-h-10 items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal-500)] ${
                  active
                    ? "bg-[var(--teal-50)] font-semibold text-[var(--teal-700)]"
                    : "text-[var(--warm-ink-2)] hover:bg-[var(--warm-surface-sunk)] hover:text-[var(--warm-ink)]"
                }`}
              >
                <Icon size={16} strokeWidth={2} aria-hidden="true" className={active ? "text-[var(--teal-600)]" : ""} />
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 目次から飛ぶ先の区切り。PC では見出し1行＋カード2列、スマホでは箱を持たず(display: contents)
 * 今までどおりカードが1列に並ぶ。1枚だけのカードには lg:col-span-2 を付けて横いっぱいにする。 */
export function SettingsSection({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-label={label}
      tabIndex={-1}
      className="contents outline-none lg:grid lg:scroll-mt-6 lg:grid-cols-2 lg:gap-x-5 lg:gap-y-4"
    >
      <p className="hidden px-1 text-sm font-bold text-[var(--warm-ink-2)] lg:col-span-2 lg:block">{label}</p>
      {children}
    </section>
  );
}
