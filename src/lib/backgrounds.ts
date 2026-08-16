export type BackgroundPeriod = "morning" | "day" | "evening" | "night";

export type BackgroundCategory = "interior" | "architecture" | "landscape" | "resort" | "city";

export interface BackgroundCandidate {
  id: string;
  period: BackgroundPeriod;
  category: BackgroundCategory;
  src: string;
  isFallback: boolean;
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

type BackgroundDefinition = Omit<BackgroundCandidate, "src" | "isFallback"> & { fallback?: boolean };

function defineBackground({ fallback = false, ...candidate }: BackgroundDefinition): BackgroundCandidate {
  return {
    ...candidate,
    src: `/backgrounds/${candidate.id}.jpg`,
    isFallback: fallback,
  };
}

export const BACKGROUND_CACHE_VERSION = "life-hub-background-v5";
export const BACKGROUND_ACCEPTANCE_SCORE = 75;

const ROTATION_POOL_SIZE = 3;
export const BACKGROUND_NEAR_TIE_SCORE_WINDOW = 1.25;

export const BACKGROUND_CANDIDATES: BackgroundCandidate[] = [
  defineBackground({
    id: "morning-window-living-v5", period: "morning", category: "interior", fallback: true,
    negativeSpace: 96, visualNoise: 93, textSafeArea: 96, mobileTextSafeArea: 91,
    glassCompatibility: 97, timeMatch: 97, desktopCrop: 97, mobileCrop: 91,
    colorHarmony: 96, brightness: 94, imageBeauty: 96,
    objectPosition: "48% center", mobileObjectPosition: "52% center",
  }),
  defineBackground({
    id: "morning-white-atrium-v5", period: "morning", category: "architecture",
    negativeSpace: 97, visualNoise: 95, textSafeArea: 97, mobileTextSafeArea: 93,
    glassCompatibility: 96, timeMatch: 95, desktopCrop: 98, mobileCrop: 94,
    colorHarmony: 94, brightness: 96, imageBeauty: 94,
    objectPosition: "52% center", mobileObjectPosition: "50% center",
  }),
  defineBackground({
    id: "morning-resort-suite-v5", period: "morning", category: "resort",
    negativeSpace: 93, visualNoise: 91, textSafeArea: 94, mobileTextSafeArea: 90,
    glassCompatibility: 96, timeMatch: 94, desktopCrop: 95, mobileCrop: 90,
    colorHarmony: 95, brightness: 93, imageBeauty: 95,
    objectPosition: "48% center", mobileObjectPosition: "54% center",
  }),
  defineBackground({
    id: "morning-mist-lake-v5", period: "morning", category: "landscape",
    negativeSpace: 98, visualNoise: 96, textSafeArea: 98, mobileTextSafeArea: 95,
    glassCompatibility: 92, timeMatch: 96, desktopCrop: 99, mobileCrop: 96,
    colorHarmony: 95, brightness: 94, imageBeauty: 93,
    objectPosition: "50% center", mobileObjectPosition: "50% center",
  }),
  defineBackground({
    id: "morning-villa-gallery-v5", period: "morning", category: "interior",
    negativeSpace: 95, visualNoise: 94, textSafeArea: 96, mobileTextSafeArea: 92,
    glassCompatibility: 96, timeMatch: 95, desktopCrop: 97, mobileCrop: 93,
    colorHarmony: 95, brightness: 95, imageBeauty: 94,
    objectPosition: "55% center", mobileObjectPosition: "57% center",
  }),
  defineBackground({
    id: "morning-coastal-pavilion-v5", period: "morning", category: "resort",
    negativeSpace: 97, visualNoise: 95, textSafeArea: 97, mobileTextSafeArea: 94,
    glassCompatibility: 95, timeMatch: 94, desktopCrop: 98, mobileCrop: 94,
    colorHarmony: 95, brightness: 94, imageBeauty: 94,
    objectPosition: "50% center", mobileObjectPosition: "52% center",
  }),
  defineBackground({
    id: "day-ocean-living-v5", period: "day", category: "interior", fallback: true,
    negativeSpace: 96, visualNoise: 94, textSafeArea: 97, mobileTextSafeArea: 92,
    glassCompatibility: 98, timeMatch: 98, desktopCrop: 97, mobileCrop: 93,
    colorHarmony: 97, brightness: 96, imageBeauty: 97,
    objectPosition: "50% center", mobileObjectPosition: "54% center",
  }),
  defineBackground({
    id: "day-concrete-gallery-v5", period: "day", category: "architecture",
    negativeSpace: 97, visualNoise: 96, textSafeArea: 97, mobileTextSafeArea: 94,
    glassCompatibility: 97, timeMatch: 96, desktopCrop: 98, mobileCrop: 95,
    colorHarmony: 94, brightness: 95, imageBeauty: 94,
    objectPosition: "48% center", mobileObjectPosition: "52% center",
  }),
  defineBackground({
    id: "day-sunlit-villa-v5", period: "day", category: "interior",
    negativeSpace: 95, visualNoise: 93, textSafeArea: 96, mobileTextSafeArea: 92,
    glassCompatibility: 98, timeMatch: 97, desktopCrop: 97, mobileCrop: 93,
    colorHarmony: 96, brightness: 96, imageBeauty: 96,
    objectPosition: "55% center", mobileObjectPosition: "60% center",
  }),
  defineBackground({
    id: "day-resort-terrace-v5", period: "day", category: "resort",
    negativeSpace: 96, visualNoise: 95, textSafeArea: 96, mobileTextSafeArea: 93,
    glassCompatibility: 96, timeMatch: 97, desktopCrop: 98, mobileCrop: 94,
    colorHarmony: 97, brightness: 96, imageBeauty: 96,
    objectPosition: "55% center", mobileObjectPosition: "62% center",
  }),
  defineBackground({
    id: "day-white-courtyard-v5", period: "day", category: "architecture",
    negativeSpace: 98, visualNoise: 96, textSafeArea: 98, mobileTextSafeArea: 95,
    glassCompatibility: 98, timeMatch: 97, desktopCrop: 99, mobileCrop: 96,
    colorHarmony: 96, brightness: 97, imageBeauty: 95,
    objectPosition: "52% center", mobileObjectPosition: "58% center",
  }),
  defineBackground({
    id: "day-minimal-coast-v5", period: "day", category: "landscape",
    negativeSpace: 99, visualNoise: 97, textSafeArea: 99, mobileTextSafeArea: 96,
    glassCompatibility: 93, timeMatch: 96, desktopCrop: 99, mobileCrop: 97,
    colorHarmony: 96, brightness: 95, imageBeauty: 93,
    objectPosition: "50% center", mobileObjectPosition: "50% center",
  }),
  defineBackground({
    id: "evening-window-lounge-v5", period: "evening", category: "interior",
    negativeSpace: 94, visualNoise: 92, textSafeArea: 95, mobileTextSafeArea: 91,
    glassCompatibility: 96, timeMatch: 97, desktopCrop: 96, mobileCrop: 92,
    colorHarmony: 96, brightness: 91, imageBeauty: 96,
    objectPosition: "48% center", mobileObjectPosition: "52% center",
  }),
  defineBackground({
    id: "evening-warm-atrium-v5", period: "evening", category: "architecture",
    negativeSpace: 94, visualNoise: 93, textSafeArea: 95, mobileTextSafeArea: 92,
    glassCompatibility: 94, timeMatch: 95, desktopCrop: 97, mobileCrop: 93,
    colorHarmony: 92, brightness: 91, imageBeauty: 94,
    objectPosition: "50% center", mobileObjectPosition: "50% center",
  }),
  defineBackground({
    id: "evening-resort-pavilion-v5", period: "evening", category: "resort",
    negativeSpace: 96, visualNoise: 95, textSafeArea: 96, mobileTextSafeArea: 93,
    glassCompatibility: 96, timeMatch: 98, desktopCrop: 98, mobileCrop: 94,
    colorHarmony: 97, brightness: 92, imageBeauty: 97,
    objectPosition: "58% center", mobileObjectPosition: "62% center",
  }),
  defineBackground({
    id: "evening-lavender-ocean-v5", period: "evening", category: "landscape",
    negativeSpace: 99, visualNoise: 97, textSafeArea: 99, mobileTextSafeArea: 97,
    glassCompatibility: 94, timeMatch: 98, desktopCrop: 99, mobileCrop: 98,
    colorHarmony: 98, brightness: 91, imageBeauty: 96,
    objectPosition: "50% center", mobileObjectPosition: "50% center",
  }),
  defineBackground({
    id: "evening-architectural-corridor-v5", period: "evening", category: "architecture",
    negativeSpace: 97, visualNoise: 95, textSafeArea: 98, mobileTextSafeArea: 94,
    glassCompatibility: 97, timeMatch: 97, desktopCrop: 98, mobileCrop: 94,
    colorHarmony: 96, brightness: 92, imageBeauty: 96,
    objectPosition: "46% center", mobileObjectPosition: "42% center",
  }),
  defineBackground({
    id: "evening-glass-pavilion-v5", period: "evening", category: "architecture", fallback: true,
    negativeSpace: 98, visualNoise: 96, textSafeArea: 98, mobileTextSafeArea: 95,
    glassCompatibility: 98, timeMatch: 98, desktopCrop: 99, mobileCrop: 96,
    colorHarmony: 98, brightness: 93, imageBeauty: 98,
    objectPosition: "44% center", mobileObjectPosition: "40% center",
  }),
  defineBackground({
    id: "night-ambient-lounge-v5", period: "night", category: "interior",
    negativeSpace: 94, visualNoise: 92, textSafeArea: 95, mobileTextSafeArea: 91,
    glassCompatibility: 97, timeMatch: 98, desktopCrop: 96, mobileCrop: 92,
    colorHarmony: 97, brightness: 86, imageBeauty: 97,
    objectPosition: "48% center", mobileObjectPosition: "52% center",
  }),
  defineBackground({
    id: "night-blue-architecture-v5", period: "night", category: "architecture",
    negativeSpace: 97, visualNoise: 95, textSafeArea: 98, mobileTextSafeArea: 94,
    glassCompatibility: 97, timeMatch: 98, desktopCrop: 98, mobileCrop: 95,
    colorHarmony: 98, brightness: 87, imageBeauty: 97,
    objectPosition: "42% center", mobileObjectPosition: "40% center",
  }),
  defineBackground({
    id: "night-window-city-v5", period: "night", category: "city",
    negativeSpace: 93, visualNoise: 91, textSafeArea: 94, mobileTextSafeArea: 90,
    glassCompatibility: 96, timeMatch: 98, desktopCrop: 96, mobileCrop: 92,
    colorHarmony: 96, brightness: 85, imageBeauty: 96,
    objectPosition: "58% center", mobileObjectPosition: "62% center",
  }),
  defineBackground({
    id: "night-ocean-resort-v5", period: "night", category: "resort",
    negativeSpace: 92, visualNoise: 91, textSafeArea: 93, mobileTextSafeArea: 89,
    glassCompatibility: 93, timeMatch: 96, desktopCrop: 95, mobileCrop: 90,
    colorHarmony: 95, brightness: 78, imageBeauty: 94,
    objectPosition: "44% center", mobileObjectPosition: "40% center",
  }),
  defineBackground({
    id: "night-moonlit-suite-v5", period: "night", category: "interior", fallback: true,
    negativeSpace: 97, visualNoise: 95, textSafeArea: 97, mobileTextSafeArea: 94,
    glassCompatibility: 98, timeMatch: 98, desktopCrop: 98, mobileCrop: 95,
    colorHarmony: 98, brightness: 88, imageBeauty: 98,
    objectPosition: "46% center", mobileObjectPosition: "44% center",
  }),
  defineBackground({
    id: "night-soft-city-terrace-v5", period: "night", category: "city",
    negativeSpace: 96, visualNoise: 94, textSafeArea: 97, mobileTextSafeArea: 93,
    glassCompatibility: 97, timeMatch: 97, desktopCrop: 98, mobileCrop: 94,
    colorHarmony: 97, brightness: 87, imageBeauty: 96,
    objectPosition: "58% center", mobileObjectPosition: "62% center",
  }),
];

export function getBackgroundPeriod(date = new Date()): BackgroundPeriod {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 16) return "day";
  if (hour >= 16 && hour < 19) return "evening";
  return "night";
}

export function getBackgroundRotationDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function generalCategoryPreference(candidate: BackgroundCandidate): number {
  if (candidate.category === "interior" || candidate.category === "architecture") return 0;
  if (candidate.category === "resort") return 1;
  return 2;
}

function mobileNightCategoryPreference(candidate: BackgroundCandidate): number {
  if (candidate.id.includes("ambient") && candidate.category === "interior") return 0;
  if (candidate.category === "architecture") return 1;
  if (candidate.id.includes("moonlit") || candidate.category === "interior") return 2;
  if (candidate.category === "resort" && !candidate.id.includes("ocean")) return 3;
  if (candidate.category === "city") return 4;
  return 5;
}

function categoryPreference(candidate: BackgroundCandidate, period: BackgroundPeriod, portrait: boolean): number {
  return portrait && period === "night"
    ? mobileNightCategoryPreference(candidate)
    : generalCategoryPreference(candidate);
}

/**
 * Keeps the established visual score authoritative. Category only reorders
 * candidates whose scores are close enough to be visually equivalent.
 */
export function rankBackgroundCandidates(
  candidates: BackgroundCandidate[],
  period: BackgroundPeriod,
  portrait: boolean,
): BackgroundCandidate[] {
  const eligible = candidates
    .filter((candidate) => candidate.period === period)
    .filter((candidate) => backgroundSuitabilityScore(candidate, portrait) >= BACKGROUND_ACCEPTANCE_SCORE)
    .sort((a, b) => backgroundSuitabilityScore(b, portrait) - backgroundSuitabilityScore(a, portrait));

  const bestScore = eligible[0] ? backgroundSuitabilityScore(eligible[0], portrait) : 0;
  const nearTop = eligible
    .filter((candidate) => backgroundSuitabilityScore(candidate, portrait) >= bestScore - BACKGROUND_NEAR_TIE_SCORE_WINDOW)
    .sort((a, b) => (
      categoryPreference(a, period, portrait) - categoryPreference(b, period, portrait) ||
      backgroundSuitabilityScore(b, portrait) - backgroundSuitabilityScore(a, portrait)
    ));
  const nearTopIds = new Set(nearTop.map((candidate) => candidate.id));
  return [...nearTop, ...eligible.filter((candidate) => !nearTopIds.has(candidate.id))];
}

export function getBackgroundRotationPool(period: BackgroundPeriod, portrait: boolean): BackgroundCandidate[] {
  const eligibleByScore = BACKGROUND_CANDIDATES
    .filter((candidate) => candidate.period === period)
    .filter((candidate) => backgroundSuitabilityScore(candidate, portrait) >= BACKGROUND_ACCEPTANCE_SCORE)
    .sort((a, b) => backgroundSuitabilityScore(b, portrait) - backgroundSuitabilityScore(a, portrait));
  const bestScore = eligibleByScore[0] ? backgroundSuitabilityScore(eligibleByScore[0], portrait) : 0;
  const nearTopIds = new Set(
    eligibleByScore
      .filter((candidate) => backgroundSuitabilityScore(candidate, portrait) >= bestScore - BACKGROUND_NEAR_TIE_SCORE_WINDOW)
      .map((candidate) => candidate.id),
  );
  let pool = rankBackgroundCandidates(BACKGROUND_CANDIDATES, period, portrait)
    .filter((candidate) => nearTopIds.has(candidate.id));

  if (portrait && period === "night") {
    const spatialCandidates = pool.filter((candidate) => mobileNightCategoryPreference(candidate) <= 2);
    if (spatialCandidates.length > 0) pool = spatialCandidates;
  }

  return pool.slice(0, ROTATION_POOL_SIZE);
}

function stableIndex(value: string, size: number): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % size;
}

function fallbackForPeriod(period: BackgroundPeriod): BackgroundCandidate {
  return (
    BACKGROUND_CANDIDATES.find((candidate) => candidate.period === period && candidate.isFallback) ??
    BACKGROUND_CANDIDATES.find((candidate) => candidate.period === period) ??
    BACKGROUND_CANDIDATES[0]
  );
}

function pruneExpiredBackgroundCache(activeDateKey: string): void {
  try {
    const storage = window.localStorage;
    const currentPrefix = `${BACKGROUND_CACHE_VERSION}:${activeDateKey}:`;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(`${BACKGROUND_CACHE_VERSION}:`) && !key.startsWith(currentPrefix)) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

/**
 * Selects from the highest-scoring local candidates with a deterministic daily
 * rotation. The date-scoped cache keeps route changes stable while allowing a
 * fresh scene on a later day. No runtime image service or network call is used.
 */
export function selectBackground(
  period: BackgroundPeriod,
  portrait: boolean,
  date = new Date(),
): BackgroundCandidate {
  const dateKey = getBackgroundRotationDateKey(date);
  const orientation = portrait ? "portrait" : "landscape";
  const cacheKey = `${BACKGROUND_CACHE_VERSION}:${dateKey}:${period}:${orientation}`;
  const pool = getBackgroundRotationPool(period, portrait);

  pruneExpiredBackgroundCache(dateKey);

  try {
    const cachedId = window.localStorage.getItem(cacheKey);
    const cached = pool.find((candidate) => candidate.id === cachedId);
    if (cached) return cached;
  } catch {
    // The deterministic selection below is stable without persistence.
  }

  const selected = pool.length > 0
    ? pool[stableIndex(`${dateKey}:${period}:${orientation}`, pool.length)]
    : fallbackForPeriod(period);

  try {
    window.localStorage.setItem(cacheKey, selected.id);
  } catch {
    // The background still works without persistence.
  }
  return selected;
}
