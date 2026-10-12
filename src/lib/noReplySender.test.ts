import { describe, expect, it } from "vitest";
import { isNoReplySender } from "./noReplySender";

describe("isNoReplySender", () => {
  it("送信専用(noreply の書き方ちがい)は返信できない側に入れる", () => {
    for (const address of [
      "noreply@example.com",
      "no-reply@example.co.jp",
      "no_reply@example.com",
      "No.Reply@Example.com",
      "donotreply@example.com",
      "do-not-reply@example.com",
      "do_not_reply@example.com",
      "dont-reply@example.com",
      "MAILER-DAEMON@googlemail.com",
      "info-noreply@shop.example.jp",
      "googlealerts-noreply@google.com",
    ]) {
      expect(isNoReplySender(address), address).toBe(true);
    }
  });

  it("名前つきの From ヘッダーでも、<> の中のアドレスで判定する", () => {
    expect(isNoReplySender("Amazon.co.jp <no-reply@amazon.co.jp>")).toBe(true);
    // 名前の側に noreply と書いてあっても、アドレスが人のものなら返信できる。
    expect(isNoReplySender('"noreply 担当" <tanaka@example.com>')).toBe(false);
  });

  it("+の後ろ(配信ごとの印)は見ずに判定する", () => {
    expect(isNoReplySender("noreply+abc123@example.com")).toBe(true);
    expect(isNoReplySender("notifications+42@github.com")).toBe(true);
  });

  it("notifications@ のような自動のお知らせ・メルマガの宛先も入れる", () => {
    for (const address of [
      "notifications@github.com",
      "notification@slack.com",
      "notify@example.com",
      "postmaster@example.com",
      "bounces@example.com",
      "newsletter@example.com",
      "mail-magazine@example.jp",
      "melmaga@example.jp",
    ]) {
      expect(isNoReplySender(address), address).toBe(true);
    }
  });

  it("ドメインの側に noreply と書いてある形も入れる", () => {
    expect(isNoReplySender("12345@noreply.github.com")).toBe(true);
    expect(isNoReplySender("alert@mail.no-reply.example.com")).toBe(true);
  });

  it("人や窓口のアドレスは返信できる側に残す", () => {
    for (const address of [
      "hr@example.com",
      "info@example.co.jp",
      "support@example.com",
      "tanaka.taro@example.com",
      // 語を部分一致させないのは、こういう人の宛先を巻き込まないため。
      "notice-tanaka@example.com",
      "news-yamada@example.com",
      "replyto@example.com",
    ]) {
      expect(isNoReplySender(address), address).toBe(false);
    }
  });

  it("アドレスとして読めないものは返信できる側に残す(欄を勝手に閉じない)", () => {
    expect(isNoReplySender("")).toBe(false);
    expect(isNoReplySender("noreply")).toBe(false);
    expect(isNoReplySender("@example.com")).toBe(false);
  });
});
