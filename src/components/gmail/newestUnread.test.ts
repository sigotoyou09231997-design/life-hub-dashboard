import { describe, expect, it } from "vitest";
import { newestUnreadMessageIds } from "./GmailInbox";

describe("先に本文を取る未読メール", () => {
  const mails = [
    { gmailMessageId: "a", readAt: 1 },
    { gmailMessageId: "b" },
    { gmailMessageId: "c" },
    { gmailMessageId: "d", readAt: 2 },
    { gmailMessageId: "e" },
    { gmailMessageId: "f" },
  ];
  it("並び順(新しい順)のまま、既読を飛ばして先頭から指定の通数だけ", () => {
    expect(newestUnreadMessageIds(mails, 3)).toBe("b,c,e");
    expect(newestUnreadMessageIds(mails, 1)).toBe("b");
  });
  it("未読が無ければ空。通数より少なければあるだけ", () => {
    expect(newestUnreadMessageIds([{ gmailMessageId: "a", readAt: 1 }], 3)).toBe("");
    expect(newestUnreadMessageIds([{ gmailMessageId: "x" }], 3)).toBe("x");
    expect(newestUnreadMessageIds([], 3)).toBe("");
  });
});
