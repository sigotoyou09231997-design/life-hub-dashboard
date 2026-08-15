export type BackgroundPeriod = "morning" | "day" | "evening" | "night";

export interface BackgroundCandidate {
  id: string;
  period: BackgroundPeriod;
  src: string;
  /** Curated UI-suitability scores. They keep selection deterministic and make
   * it possible to add more AI-generated candidates without touching layout. */
  negativeSpace: number;
  lowContrast: number;
  desktopCrop: number;
  mobileCrop: number;
  objectPosition: string;
  mobileObjectPosition: string;
}

const BACKGROUND_CACHE_VERSION = "life-hub-background-v3";

export const BACKGROUND_CANDIDATES: BackgroundCandidate[] = [
  {
    id: "morning-coast",
    period: "morning",
    src: "/backgrounds/lifehub-morning.jpg",
    negativeSpace: 0.96,
    lowContrast: 0.94,
    desktopCrop: 0.96,
    mobileCrop: 0.86,
    objectPosition: "48% center",
    mobileObjectPosition: "58% center",
  },
  {
    id: "day-coast",
    period: "day",
    src: "/backgrounds/lifehub-day.jpg",
    negativeSpace: 0.93,
    lowContrast: 0.9,
    desktopCrop: 0.98,
    mobileCrop: 0.88,
    objectPosition: "45% center",
    mobileObjectPosition: "56% center",
  },
  {
    id: "evening-coast",
    period: "evening",
    src: "/backgrounds/lifehub-evening.jpg",
    negativeSpace: 0.95,
    lowContrast: 0.9,
    desktopCrop: 0.98,
    mobileCrop: 0.9,
    objectPosition: "47% center",
    mobileObjectPosition: "56% center",
  },
  {
    id: "night-coast",
    period: "night",
    src: "/backgrounds/lifehub-night.jpg",
    negativeSpace: 0.94,
    lowContrast: 0.91,
    desktopCrop: 0.97,
    mobileCrop: 0.88,
    objectPosition: "48% center",
    mobileObjectPosition: "58% center",
  },
];

export function getBackgroundPeriod(date = new Date()): BackgroundPeriod {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 16) return "day";
  if (hour >= 16 && hour < 19) return "evening";
  return "night";
}

function suitabilityScore(candidate: BackgroundCandidate, portrait: boolean): number {
  const cropScore = portrait ? candidate.mobileCrop : candidate.desktopCrop;
  // Negative space and safe cropping dominate selection. Candidates are
  // manually admitted only when text/people are absent and visual noise is low.
  return candidate.negativeSpace * 0.55 + candidate.lowContrast * 0.2 + cropScore * 0.25;
}

/**
 * Selects an AI-curated local asset for the current time and viewport. The
 * selected id is cached per time band so page navigation never changes the
 * scene. This intentionally has no runtime network dependency: future
 * candidates can be added to the manifest and are evaluated by the same
 * readability-first scoring model.
 */
export function selectBackground(period: BackgroundPeriod, portrait: boolean): BackgroundCandidate {
  const candidates = BACKGROUND_CANDIDATES.filter((candidate) => candidate.period === period);
  const cacheKey = `${BACKGROUND_CACHE_VERSION}:${period}:${portrait ? "portrait" : "landscape"}`;

  try {
    const cachedId = window.localStorage.getItem(cacheKey);
    const cached = candidates.find((candidate) => candidate.id === cachedId);
    if (cached) return cached;
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }

  const selected = [...candidates].sort((a, b) => suitabilityScore(b, portrait) - suitabilityScore(a, portrait))[0];
  // The manifest always contains one candidate per time band. This fallback
  // makes the contract safe if an incomplete manifest is shipped later.
  const fallback = selected ?? BACKGROUND_CANDIDATES[0];
  try {
    window.localStorage.setItem(cacheKey, fallback.id);
  } catch {
    // The background still works without persistence.
  }
  return fallback;
}
