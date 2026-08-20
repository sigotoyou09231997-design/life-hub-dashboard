import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUICK_ACTION_KEYS,
  QUICK_ACTION_STORAGE_KEY,
  loadQuickActionKeys,
  normalizeQuickActionKeys,
  saveQuickActionKeys,
} from "./quickActions";

class MemoryStorage {
  value: string | null = null;
  getItem(key: string) { return key === QUICK_ACTION_STORAGE_KEY ? this.value : null; }
  setItem(key: string, value: string) { if (key === QUICK_ACTION_STORAGE_KEY) this.value = value; }
}

describe("quick action customization", () => {
  it("uses the current default actions by default", () => {
    expect(loadQuickActionKeys(new MemoryStorage())).toEqual(DEFAULT_QUICK_ACTION_KEYS);
  });

  it("keeps a custom order and allows travel", () => {
    expect(normalizeQuickActionKeys(["trips", "money", "notes"])).toEqual(["trips", "money", "notes"]);
  });

  it("filters unknown and duplicate entries", () => {
    expect(normalizeQuickActionKeys(["trips", "trips", "unknown", "gmail", "notes", "money"]))
      .toEqual(["trips", "gmail", "notes", "money"]);
  });

  it("migrates the old separate schedule-calendar/schedule-tasks keys to the merged schedule key, deduping if a saved selection had both", () => {
    expect(normalizeQuickActionKeys(["schedule-calendar", "schedule-tasks", "money"])).toEqual(["schedule", "money"]);
  });

  it("falls back safely for corrupt or empty storage", () => {
    const storage = new MemoryStorage();
    storage.value = "not-json";
    expect(loadQuickActionKeys(storage)).toEqual(DEFAULT_QUICK_ACTION_KEYS);
    expect(normalizeQuickActionKeys([])).toEqual(DEFAULT_QUICK_ACTION_KEYS);
  });

  it("persists a normalized selection", () => {
    const storage = new MemoryStorage();
    const saved = saveQuickActionKeys(["trips", "schedule"], storage);
    expect(saved).toEqual(["trips", "schedule"]);
    expect(loadQuickActionKeys(storage)).toEqual(saved);
  });
});
