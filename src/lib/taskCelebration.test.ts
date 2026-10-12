import { describe, expect, it } from "vitest";
import { markRingCelebrated, readRingCelebratedDate, RING_CELEBRATED_KEY, shouldCelebrateRing } from "./taskCelebration";

const TODAY = "2026-10-12";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

function brokenStorage(): Storage {
  const fail = () => {
    throw new Error("SecurityError");
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

describe("今日の輪を光らせるか(shouldCelebrateRing)", () => {
  it("残りが1件 → 0件になった(最後の1件を完了した)時に光らせる", () => {
    expect(shouldCelebrateRing({ total: 3, completed: 2 }, { total: 3, completed: 3 }, null, TODAY)).toBe(true);
  });

  it("今日もう光らせていれば光らせない(1日1回)", () => {
    expect(shouldCelebrateRing({ total: 3, completed: 2 }, { total: 3, completed: 3 }, TODAY, TODAY)).toBe(false);
    // 昨日光らせていても、今日はまた光る。
    expect(shouldCelebrateRing({ total: 3, completed: 2 }, { total: 3, completed: 3 }, "2026-10-11", TODAY)).toBe(true);
  });

  it("開いた時にもう全部終わっていた時は光らせない", () => {
    expect(shouldCelebrateRing(null, { total: 3, completed: 3 }, null, TODAY)).toBe(false);
    // 読み込み中(0件)→ 読み終わったら全部完了、も同じ。
    expect(shouldCelebrateRing({ total: 0, completed: 0 }, { total: 3, completed: 3 }, null, TODAY)).toBe(false);
  });

  it("残りを明日へ送った・消した時は光らせない(完了の数が増えていない)", () => {
    expect(shouldCelebrateRing({ total: 2, completed: 1 }, { total: 1, completed: 1 }, null, TODAY)).toBe(false);
  });

  it("まだ残っている間は光らせない", () => {
    expect(shouldCelebrateRing({ total: 3, completed: 1 }, { total: 3, completed: 2 }, null, TODAY)).toBe(false);
  });

  it("今日のタスクが無い日は光らせない", () => {
    expect(shouldCelebrateRing({ total: 1, completed: 0 }, { total: 0, completed: 0 }, null, TODAY)).toBe(false);
  });
});

describe("光らせた日の控え", () => {
  it("書いた日を読み戻せる", () => {
    const store = memoryStorage();
    expect(readRingCelebratedDate(store)).toBeNull();
    markRingCelebrated(TODAY, store);
    expect(store.getItem(RING_CELEBRATED_KEY)).toBe(TODAY);
    expect(readRingCelebratedDate(store)).toBe(TODAY);
  });

  it("保存が使えない端末(プライベートブラウズ等)でも止まらない", () => {
    const store = brokenStorage();
    expect(() => markRingCelebrated(TODAY, store)).not.toThrow();
    expect(readRingCelebratedDate(store)).toBeNull();
    expect(readRingCelebratedDate(null)).toBeNull();
  });
});
