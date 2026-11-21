/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { LIFECYCLE_LOG_KEY, isIOSDevice, logLifecycle, readLifecycleLog } from "./lifecycleLog";

beforeEach(() => localStorage.clear());

describe("動きの記録", () => {
  it("時刻つきで残し、新しい40行だけを持つ", () => {
    for (let i = 0; i < 45; i++) logLifecycle(`出来事${i}`, new Date(2026, 10, 21, 9, 0, i));
    const lines = readLifecycleLog();
    expect(lines).toHaveLength(40);
    expect(lines[0]).toBe("11/21 09:00:05 出来事5");
    expect(lines[39]).toBe("11/21 09:00:44 出来事44");
  });

  it("壊れた記録が残っていても、空として読んで書き足せる", () => {
    localStorage.setItem(LIFECYCLE_LOG_KEY, "{壊れている");
    expect(readLifecycleLog()).toEqual([]);
    logLifecycle("起動", new Date(2026, 10, 21, 9, 0, 0));
    expect(readLifecycleLog()).toEqual(["11/21 09:00:00 起動"]);
  });
});

describe("isIOSDevice", () => {
  it("iPhone・iPad(Mac と名乗るものも指で触れれば)を見分け、PC は違うとする", () => {
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 })).toBe(true);
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", platform: "Win32", maxTouchPoints: 0 })).toBe(false);
  });
});
