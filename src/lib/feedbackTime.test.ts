import { describe, expect, it } from "vitest";
import { agoLabel } from "./feedbackTime";

const at = "2026-10-14T00:00:00Z";
const after = (minutes: number) => new Date(at).getTime() + minutes * 60_000;

describe("agoLabel(届いてからの経過)", () => {
  it("1分未満は「たった今」、1時間未満は分、1日未満は時間、それ以上は日", () => {
    expect(agoLabel(at, after(0.5))).toBe("たった今");
    expect(agoLabel(at, after(1))).toBe("1分前");
    expect(agoLabel(at, after(59))).toBe("59分前");
    expect(agoLabel(at, after(60))).toBe("1時間前");
    expect(agoLabel(at, after(23 * 60 + 59))).toBe("23時間前");
    expect(agoLabel(at, after(24 * 60))).toBe("1日前");
    expect(agoLabel(at, after(3 * 24 * 60 + 5))).toBe("3日前");
  });

  it("端末の時計が遅れて、届いた時刻が未来になっても「たった今」(マイナスにしない)。壊れた日付は空", () => {
    expect(agoLabel(at, after(-10))).toBe("たった今");
    expect(agoLabel("壊れた日付", after(5))).toBe("");
  });
});
