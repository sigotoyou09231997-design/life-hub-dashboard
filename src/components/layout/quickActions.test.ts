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
  it("uses the current five actions by default", () => {
    expect(loadQuickActionKeys(new MemoryStorage())).toEqual(DEFAULT_QUICK_ACTION_KEYS);
  });

  it("keeps a custom order and allows travel", () => {
    expect(normalizeQuickActionKeys(["trips", "money", "notes"])).toEqual(["trips", "money", "notes"]);
  });

  it("filters unknown and duplicate entries and caps the dock at five", () => {
    expect(normalizeQuickActionKeys(["trips", "trips", "unknown", "gmail", "notes", "money", "schedule-tasks", "schedule-calendar"]))
      .toEqual(["trips", "gmail", "notes", "money", "schedule-tasks"]);
  });

  it("falls back safely for corrupt or empty storage", () => {
    const storage = new MemoryStorage();
    storage.value = "not-json";
    expect(loadQuickActionKeys(storage)).toEqual(DEFAULT_QUICK_ACTION_KEYS);
    expect(normalizeQuickActionKeys([])).toEqual(DEFAULT_QUICK_ACTION_KEYS);
  });

  it("persists a normalized selection", () => {
    const storage = new MemoryStorage();
    const saved = saveQuickActionKeys(["trips", "schedule-calendar"], storage);
    expect(saved).toEqual(["trips", "schedule-calendar"]);
    expect(loadQuickActionKeys(storage)).toEqual(saved);
  });
});
