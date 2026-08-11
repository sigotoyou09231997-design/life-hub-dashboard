import type { CSSProperties } from "react";

/**
 * Fixed per-area accent colors, matching TOP's card identity colors exactly
 * (see TopPage.tsx's ACCENT_STYLES). Applied by overriding --color-accent /
 * --color-accent-light on each area's root element so every Tailwind
 * `accent`-family class (bg-accent, text-accent, ring-accent, ...) used by
 * nested components picks it up automatically — no per-component edits needed.
 * This intentionally overrides the user's Settings accent-color choice within
 * these areas so the four sections stay visually consistent with their TOP card.
 */
export const AREA_ACCENT_STYLE: Record<"money" | "schedule" | "notes" | "trips", CSSProperties> = {
  money: { "--color-accent": "#2563eb", "--color-accent-light": "#eff6ff" } as CSSProperties,
  schedule: { "--color-accent": "#7c3aed", "--color-accent-light": "#f5f3ff" } as CSSProperties,
  notes: { "--color-accent": "#0d9488", "--color-accent-light": "#f0fdfa" } as CSSProperties,
  trips: { "--color-accent": "#ea580c", "--color-accent-light": "#fff7ed" } as CSSProperties,
};
