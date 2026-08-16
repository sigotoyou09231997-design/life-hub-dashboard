import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_ACCEPTANCE_SCORE,
  BACKGROUND_CACHE_VERSION,
  BACKGROUND_CANDIDATES,
  BACKGROUND_NEAR_TIE_SCORE_WINDOW,
  backgroundSuitabilityScore,
  getBackgroundPeriod,
  getBackgroundRotationDateKey,
  getBackgroundRotationPool,
  rankBackgroundCandidates,
  selectBackground,
  type BackgroundCandidate,
  type BackgroundCategory,
  type BackgroundPeriod,
} from "./backgrounds";

const PERIODS: BackgroundPeriod[] = ["morning", "day", "evening", "night"];

function scoredCandidate(
  id: string,
  category: BackgroundCategory,
  score: number,
  period: BackgroundPeriod = "day",
): BackgroundCandidate {
  return {
    ...BACKGROUND_CANDIDATES[0],
    id,
    period,
    category,
    src: `/backgrounds/${id}.jpg`,
    isFallback: false,
    negativeSpace: score,
    visualNoise: score,
    textSafeArea: score,
    mobileTextSafeArea: score,
    glassCompatibility: score,
    timeMatch: score,
    desktopCrop: score,
    mobileCrop: score,
    colorHarmony: score,
    brightness: score,
    imageBeauty: score,
  };
}

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("background candidate refresh", () => {
  it("provides six reviewed local candidates per time band", () => {
    expect(BACKGROUND_CANDIDATES).toHaveLength(24);
    for (const period of PERIODS) {
      expect(BACKGROUND_CANDIDATES.filter((candidate) => candidate.period === period)).toHaveLength(6);
    }
    expect(BACKGROUND_CANDIDATES.every((candidate) => candidate.src.startsWith("/backgrounds/"))).toBe(true);
  });

  it("keeps every desktop and mobile score above the acceptance threshold", () => {
    for (const candidate of BACKGROUND_CANDIDATES) {
      expect(backgroundSuitabilityScore(candidate, false)).toBeGreaterThanOrEqual(BACKGROUND_ACCEPTANCE_SCORE);
      expect(backgroundSuitabilityScore(candidate, true)).toBeGreaterThanOrEqual(BACKGROUND_ACCEPTANCE_SCORE);
    }
  });

  it("defines exactly one dedicated high-quality fallback for each period", () => {
    for (const period of PERIODS) {
      const fallbacks = BACKGROUND_CANDIDATES.filter((candidate) => candidate.period === period && candidate.isFallback);
      expect(fallbacks).toHaveLength(1);
      expect(backgroundSuitabilityScore(fallbacks[0], false)).toBeGreaterThan(90);
      expect(fallbacks[0].id).toMatch(/-v5$/);
    }
  });

  it("prefers architecture in a near tie without changing the visual score", () => {
    const landscape = scoredCandidate("near-landscape", "landscape", 97.4);
    const architecture = scoredCandidate("near-architecture", "architecture", 97.2);

    expect(BACKGROUND_NEAR_TIE_SCORE_WINDOW).toBe(1.25);
    expect(rankBackgroundCandidates([landscape, architecture], "day", false)[0].id).toBe("near-architecture");
    expect(backgroundSuitabilityScore(landscape, false)).toBeCloseTo(97.4);
    expect(backgroundSuitabilityScore(architecture, false)).toBeCloseTo(97.2);
  });

  it("keeps the higher visual score first when the difference is not a near tie", () => {
    const landscape = scoredCandidate("clear-winner", "landscape", 97.4);
    const architecture = scoredCandidate("lower-architecture", "architecture", 95.8);

    expect(rankBackgroundCandidates([architecture, landscape], "day", false)[0].id).toBe("clear-winner");
  });

  it("gives Mobile Night spatial candidates priority over a near-tied city view", () => {
    const city = scoredCandidate("night-city-view", "city", 95.6, "night");
    const interior = scoredCandidate("night-moonlit-interior", "interior", 95.4, "night");

    expect(rankBackgroundCandidates([city, interior], "night", true)[0].id).toBe("night-moonlit-interior");
    expect(getBackgroundRotationPool("night", true).map((candidate) => candidate.id)).toEqual([
      "night-blue-architecture-v5",
      "night-moonlit-suite-v5",
    ]);
  });

  it("excludes candidates below 75 before applying category preference", () => {
    const accepted = scoredCandidate("accepted-landscape", "landscape", 90);
    const rejected = scoredCandidate("rejected-architecture", "architecture", 74.9);

    expect(rankBackgroundCandidates([rejected, accepted], "day", false).map((candidate) => candidate.id)).toEqual([
      "accepted-landscape",
    ]);
  });

  it("builds category-aware near-top pools without admitting a large score gap", () => {
    expect(getBackgroundRotationPool("day", false).map((candidate) => candidate.id)).toEqual([
      "day-white-courtyard-v5",
      "day-ocean-living-v5",
      "day-concrete-gallery-v5",
    ]);
    expect(getBackgroundRotationPool("evening", false).map((candidate) => candidate.id)).toEqual([
      "evening-glass-pavilion-v5",
      "evening-architectural-corridor-v5",
      "evening-lavender-ocean-v5",
    ]);
  });

  it("is stable across page transitions within a day and rotates across dates", () => {
    for (const period of PERIODS) {
      const date = new Date(2026, 7, 17, 12);
      expect(selectBackground(period, false, date).id).toBe(selectBackground(period, false, date).id);

      const selectedAcrossTwoWeeks = new Set(
        Array.from({ length: 14 }, (_, offset) => selectBackground(period, false, new Date(2026, 7, 17 + offset, 12)).id),
      );
      expect(selectedAcrossTwoWeeks.size).toBeGreaterThan(1);
    }
  });

  it("uses a V5 date-scoped cache and prunes only expired background keys", () => {
    const storage = new MemoryStorage();
    storage.setItem(`${BACKGROUND_CACHE_VERSION}:2026-08-16:day:landscape`, "stale");
    storage.setItem("life-hub-unrelated", "preserve");
    vi.stubGlobal("window", { localStorage: storage });

    const date = new Date(2026, 7, 17, 12);
    const selected = selectBackground("day", false, date);
    const cacheKey = `${BACKGROUND_CACHE_VERSION}:${getBackgroundRotationDateKey(date)}:day:landscape`;

    expect(storage.getItem(cacheKey)).toBe(selected.id);
    expect(storage.getItem(`${BACKGROUND_CACHE_VERSION}:2026-08-16:day:landscape`)).toBeNull();
    expect(storage.getItem("life-hub-unrelated")).toBe("preserve");
  });

  it("preserves the established period boundaries", () => {
    expect(getBackgroundPeriod(new Date(2026, 7, 17, 5))).toBe("morning");
    expect(getBackgroundPeriod(new Date(2026, 7, 17, 11))).toBe("day");
    expect(getBackgroundPeriod(new Date(2026, 7, 17, 16))).toBe("evening");
    expect(getBackgroundPeriod(new Date(2026, 7, 17, 19))).toBe("night");
  });
});
