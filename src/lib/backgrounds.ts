export type BackgroundPeriod = "morning" | "day" | "evening" | "night";

export interface BackgroundCandidate {
  id: string;
  period: BackgroundPeriod;
  src: string;
  /** 100-point visual review inputs. Assets are admitted only after the
   * people/text/logo/noise checks have passed. */
  negativeSpace: number;
  visualNoise: number;
  textSafeArea: number;
  mobileTextSafeArea: number;
  glassCompatibility: number;
  timeMatch: number;
  desktopCrop: number;
  mobileCrop: number;
  colorHarmony: number;
  brightness: number;
  imageBeauty: number;
  objectPosition: string;
  mobileObjectPosition: string;
}

const BACKGROUND_CACHE_VERSION = "life-hub-background-v4";

export const BACKGROUND_CANDIDATES: BackgroundCandidate[] = [
  {
    id: "morning-coast",
    period: "morning",
    src: "/backgrounds/lifehub-morning.jpg",
    negativeSpace: 96,
    visualNoise: 94,
    textSafeArea: 96,
    mobileTextSafeArea: 88,
    glassCompatibility: 95,
    timeMatch: 94,
    desktopCrop: 96,
    mobileCrop: 86,
    colorHarmony: 94,
    brightness: 93,
    imageBeauty: 92,
    objectPosition: "48% center",
    mobileObjectPosition: "58% center",
  },
  {
    id: "day-coast",
    period: "day",
    src: "/backgrounds/lifehub-day.jpg",
    negativeSpace: 93,
    visualNoise: 90,
    textSafeArea: 95,
    mobileTextSafeArea: 89,
    glassCompatibility: 94,
    timeMatch: 93,
    desktopCrop: 98,
    mobileCrop: 88,
    colorHarmony: 95,
    brightness: 94,
    imageBeauty: 92,
    objectPosition: "45% center",
    mobileObjectPosition: "56% center",
  },
  {
    id: "evening-coast",
    period: "evening",
    src: "/backgrounds/lifehub-evening.jpg",
    negativeSpace: 95,
    visualNoise: 90,
    textSafeArea: 96,
    mobileTextSafeArea: 91,
    glassCompatibility: 94,
    timeMatch: 96,
    desktopCrop: 98,
    mobileCrop: 90,
    colorHarmony: 93,
    brightness: 90,
    imageBeauty: 95,
    objectPosition: "47% center",
    mobileObjectPosition: "56% center",
  },
  {
    id: "night-coast",
    period: "night",
    src: "/backgrounds/lifehub-night.jpg",
    negativeSpace: 94,
    visualNoise: 91,
    textSafeArea: 95,
    mobileTextSafeArea: 89,
    glassCompatibility: 94,
    timeMatch: 95,
    desktopCrop: 97,
    mobileCrop: 88,
    colorHarmony: 94,
    brightness: 89,
    imageBeauty: 94,
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

export function backgroundSuitabilityScore(candidate: BackgroundCandidate, portrait: boolean): number {
  const cropScore = portrait ? candidate.mobileCrop : candidate.desktopCrop;
  const textSafeArea = portrait ? candidate.mobileTextSafeArea : candidate.textSafeArea;
  return (
    candidate.negativeSpace * .22 +
    candidate.visualNoise * .17 +
    textSafeArea * .16 +
    cropScore * .12 +
    candidate.colorHarmony * .1 +
    candidate.timeMatch * .09 +
    candidate.brightness * .07 +
    candidate.imageBeauty * .05 +
    candidate.glassCompatibility * .02
  );
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

  const eligible = candidates.filter((candidate) => backgroundSuitabilityScore(candidate, portrait) >= 75);
  const selected = [...eligible].sort((a, b) => backgroundSuitabilityScore(b, portrait) - backgroundSuitabilityScore(a, portrait))[0];
  // The manifest always contains one candidate per time band. This fallback
  // makes the contract safe if an incomplete manifest is shipped later.
  const fallback = selected ?? candidates[0] ?? BACKGROUND_CANDIDATES[0];
  try {
    window.localStorage.setItem(cacheKey, fallback.id);
  } catch {
    // The background still works without persistence.
  }
  return fallback;
}
