import { describe, expect, it } from "vitest";
import { buildUpdateNotificationPayload, decideUpdatePush, isNightJst, UPDATE_QUIET_MS } from "../functions/checkAppUpdate";

describe("buildUpdateNotificationPayload", () => {
  it("builds a lock-screen-style notification pointing at the app root", () => {
    const payload = JSON.parse(buildUpdateNotificationPayload());
    expect(payload.title).toBe("LIFE HUBがアップデートされました");
    expect(payload.url).toBe("/");
    expect(payload.body.length).toBeGreaterThan(0);
  });
});

/** 日本時間のその時刻（ミリ秒）。 */
const jst = (iso: string) => Date.parse(`${iso}+09:00`);
const MIN = 60_000;

describe("decideUpdatePush", () => {
  it("初めての実行は、基準を記録するだけで送らない", () => {
    expect(decideUpdatePush(null, null, "abc", jst("2026-10-12T12:00:00"))).toBe("baseline");
  });

  it("送った版のままなら何もしない", () => {
    const now = jst("2026-10-12T12:00:00");
    expect(decideUpdatePush("abc", { version: "abc", at: now - 5 * MIN }, "abc", now)).toBe("idle");
  });

  it("新しい版を見つけたら、すぐには送らずに見つけた時刻を記録する", () => {
    const now = jst("2026-10-12T12:00:00");
    expect(decideUpdatePush("abc", { version: "abc", at: now - 60 * MIN }, "def", now)).toBe("track");
    // 2行目がまだ無い（この仕組みを入れた直後）時も同じ
    expect(decideUpdatePush("abc", null, "def", now)).toBe("track");
  });

  it("続けて出している間は送らない。最後の版から40分静かになったら1回だけ送る", () => {
    const foundAt = jst("2026-10-12T12:00:00");
    const latest = { version: "ghi", at: foundAt };
    expect(decideUpdatePush("abc", latest, "ghi", foundAt + 10 * MIN)).toBe("wait");
    expect(decideUpdatePush("abc", latest, "ghi", foundAt + UPDATE_QUIET_MS - 1)).toBe("wait");
    expect(decideUpdatePush("abc", latest, "ghi", foundAt + UPDATE_QUIET_MS)).toBe("notify");
    // 送ったあと（送った版＝最新）は、もう送らない
    expect(decideUpdatePush("ghi", latest, "ghi", foundAt + UPDATE_QUIET_MS + 2 * MIN)).toBe("idle");
  });

  it("夜（22時〜7時）は送らずに、朝7時まで持ち越す", () => {
    const latest = { version: "def", at: jst("2026-10-12T21:50:00") };
    expect(decideUpdatePush("abc", latest, "def", jst("2026-10-12T22:40:00"))).toBe("wait");
    expect(decideUpdatePush("abc", latest, "def", jst("2026-10-13T03:00:00"))).toBe("wait");
    expect(decideUpdatePush("abc", latest, "def", jst("2026-10-13T07:00:00"))).toBe("notify");
  });
});

describe("isNightJst", () => {
  it("日本時間の22時から翌7時の手前までを夜とみなす", () => {
    expect(isNightJst(jst("2026-10-12T21:59:00"))).toBe(false);
    expect(isNightJst(jst("2026-10-12T22:00:00"))).toBe(true);
    expect(isNightJst(jst("2026-10-13T06:59:00"))).toBe(true);
    expect(isNightJst(jst("2026-10-13T07:00:00"))).toBe(false);
  });
});
