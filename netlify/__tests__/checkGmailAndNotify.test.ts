import { describe, expect, it } from "vitest";
import { buildNotificationPayload } from "../functions/checkGmailAndNotify";

describe("buildNotificationPayload", () => {
  it("uses the sender's display name as the title, and a labeled subject+snippet as the body", () => {
    const payload = JSON.parse(
      buildNotificationPayload(1, { from: '"田中太郎" <taro@example.com>', subject: "会議の件", snippet: "来週の会議についてご相談が..." }),
    );
    expect(payload.title).toBe("田中太郎");
    expect(payload.body).toBe("件名: 会議の件\n来週の会議についてご相談が...");
    expect(payload.url).toBe("/gmail");
  });

  it("falls back to the raw address when the From header has no display name, and omits an empty snippet line", () => {
    const payload = JSON.parse(buildNotificationPayload(1, { from: "a@example.com", subject: "テスト", snippet: "" }));
    expect(payload.title).toBe("a@example.com");
    expect(payload.body).toBe("件名: テスト");
  });

  it("appends a count of the remaining messages to the title when multiple arrived", () => {
    const payload = JSON.parse(buildNotificationPayload(3, { from: "a@example.com", subject: "件名", snippet: "本文" }));
    expect(payload.title).toBe("a@example.com 他2件");
  });

  it("falls back to a generic count-based title/empty body when the newest message's metadata couldn't be fetched", () => {
    const payload = JSON.parse(buildNotificationPayload(2, null));
    expect(payload.title).toBe("新着メール 2件");
    expect(payload.body).toBe("");
  });
});
