import { describe, expect, it } from "vitest";
import { buildNotificationPayload } from "../functions/checkGmailAndNotify";

describe("buildNotificationPayload", () => {
  it("uses the singular title and includes sender/subject when exactly one new message arrived", () => {
    const payload = JSON.parse(buildNotificationPayload(1, { from: "田中太郎 <taro@example.com>", subject: "会議の件" }));
    expect(payload.title).toBe("新着メール");
    expect(payload.body).toBe("田中太郎 <taro@example.com>: 会議の件");
    expect(payload.url).toBe("/gmail");
  });

  it("uses a count in the title when multiple new messages arrived", () => {
    const payload = JSON.parse(buildNotificationPayload(3, { from: "a@example.com", subject: "件名" }));
    expect(payload.title).toBe("新着メール 3件");
  });

  it("falls back to an empty body when the newest message's metadata couldn't be fetched", () => {
    const payload = JSON.parse(buildNotificationPayload(2, null));
    expect(payload.title).toBe("新着メール 2件");
    expect(payload.body).toBe("");
  });
});
