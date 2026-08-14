import { useEffect, useState } from "react";

/** Matches Tailwind's `lg` breakpoint (1024px) — for the rare case a component
 * needs to branch behavior (not just layout) between the desktop 3-pane Gmail
 * view and the mobile list+Sheet view, since CSS alone can't gate whether a
 * Sheet is "open". */
export function useIsDesktop(): boolean {
  const query = "(min-width: 1024px)";
  const [isDesktop, setIsDesktop] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isDesktop;
}
