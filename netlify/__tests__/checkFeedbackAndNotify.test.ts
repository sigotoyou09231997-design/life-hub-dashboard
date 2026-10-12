import { describe, expect, it } from "vitest";
import { buildFeedbackNotificationPayload, isNightJst } from "../functions/checkFeedbackAndNotify";

describe("buildFeedbackNotificationPayload", () => {
  it("1件なら、誰からかと依頼の先頭を出し、設定(届いた要望)を開く", () => {
    const payload = JSON.parse(
      buildFeedbackNotificationPayload([{ message: "予定の詳細でURLを貼れない", sender_name: "えっくん", trip_name: null, via: "app" }]),
    );
    expect(payload).toEqual({ title: "修正依頼が届きました", body: "えっくん: 予定の詳細でURLを貼れない", url: "/settings" });
  });

  it("何件かまとめて届いたら件数を出し、いちばん新しいものの先頭を出す", () => {
    const payload = JSON.parse(
      buildFeedbackNotificationPayload([
        { message: "1件目", sender_name: null, trip_name: null, via: "app" },
        { message: "2件目", sender_name: null, trip_name: "四国旅行", via: "share" },
      ]),
    );
    expect(payload.title).toBe("修正依頼が2件届きました");
    expect(payload.body).toBe("しおり「四国旅行」から: 2件目");
  });

  it("長い依頼は先頭だけにし、改行は1行にまとめる", () => {
    const long = "あ".repeat(80);
    const payload = JSON.parse(buildFeedbackNotificationPayload([{ message: `一行目\n${long}`, sender_name: null, trip_name: null, via: "app" }]));
    expect(payload.body.startsWith("アプリから: 一行目 あ")).toBe(true);
    expect(payload.body.endsWith("…")).toBe(true);
    expect(payload.body.length).toBeLessThanOrEqual("アプリから: ".length + 61);
  });
});

describe("isNightJst", () => {
  const jst = (iso: string) => Date.parse(`${iso}+09:00`);
  it("日本時間の22時〜7時は夜(送らずに朝まで待つ)", () => {
    expect(isNightJst(jst("2026-10-12T22:30:00"))).toBe(true);
    expect(isNightJst(jst("2026-10-13T06:59:00"))).toBe(true);
    expect(isNightJst(jst("2026-10-13T07:00:00"))).toBe(false);
    expect(isNightJst(jst("2026-10-12T21:59:00"))).toBe(false);
  });
});
