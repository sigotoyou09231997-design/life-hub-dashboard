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
  money: { "--color-accent": "#d97736", "--color-accent-light": "rgba(255, 244, 230, .76)" } as CSSProperties,
  schedule: { "--color-accent": "#4f6fff", "--color-accent-light": "rgba(232, 241, 255, .78)" } as CSSProperties,
  notes: { "--color-accent": "#7564d8", "--color-accent-light": "rgba(241, 237, 255, .78)" } as CSSProperties,
  trips: { "--color-accent": "#2c8b91", "--color-accent-light": "rgba(229, 247, 247, .78)" } as CSSProperties,
};
