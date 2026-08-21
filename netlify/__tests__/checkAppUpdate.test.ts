import { describe, expect, it } from "vitest";
import { buildUpdateNotificationPayload, shouldNotify } from "../functions/checkAppUpdate";

describe("buildUpdateNotificationPayload", () => {
  it("builds a lock-screen-style notification pointing at the app root", () => {
    const payload = JSON.parse(buildUpdateNotificationPayload());
    expect(payload.title).toBe("LIFE HUBがアップデートされました");
    expect(payload.url).toBe("/");
    expect(payload.body.length).toBeGreaterThan(0);
  });
});

describe("shouldNotify", () => {
  it("does not notify on the very first run, when there's no baseline to compare against", () => {
    expect(shouldNotify(null, "abc123")).toBe(false);
  });

  it("does not notify when the deployed version matches the last-recorded one", () => {
    expect(shouldNotify("abc123", "abc123")).toBe(false);
  });

  it("notifies when the deployed version differs from the last-recorded one", () => {
    expect(shouldNotify("abc123", "def456")).toBe(true);
  });
});
