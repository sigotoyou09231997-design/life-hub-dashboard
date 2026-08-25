import { describe, expect, it, vi } from "vitest";
import {
  attachmentsTotalBytes,
  buildSyncSummary,
  describeGmailConnectError,
  base64UrlDecode,
  base64UrlEncode,
  buildRawMessage,
  encodeHeaderWord,
  isUnhandledEmail,
  mapWithConcurrency,
} from "./gmail";

describe("base64UrlEncode/base64UrlDecode", () => {
  it("round-trips ASCII text", () => {
    const text = "Hello, world!";
    expect(base64UrlDecode(base64UrlEncode(text))).toBe(text);
  });

  it("round-trips Japanese text", () => {
    const text = "こんにちは、これはテストメールです。";
    expect(base64UrlDecode(base64UrlEncode(text))).toBe(text);
  });

  it("produces URL-safe output with no padding", () => {
    const encoded = base64UrlEncode("any carnal pleasure.");
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe("encodeHeaderWord", () => {
  it("leaves plain ASCII text untouched", () => {
    expect(encodeHeaderWord("Re: Meeting notes")).toBe("Re: Meeting notes");
  });

  it("encodes non-ASCII text as an RFC 2047 encoded-word", () => {
    const encoded = encodeHeaderWord("Re: 会議のお知らせ");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
  });
});

describe("buildRawMessage", () => {
  const headers = { to: "taro@example.com", subject: "テスト" };

  it("builds a plain text/plain message when there are no attachments", () => {
    const raw = buildRawMessage(headers, "本文です", []);
    expect(raw).toContain("To: taro@example.com");
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(raw).not.toContain("multipart/mixed");
    expect(raw.endsWith("本文です")).toBe(true);
  });

  it("builds a multipart/mixed message with a boundary-delimited attachment part", () => {
    const raw = buildRawMessage(headers, "本文です", [{ filename: "test.txt", mimeType: "text/plain", base64Data: "aGVsbG8=" }]);
    expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="([^"]+)"/);
    const boundary = raw.match(/boundary="([^"]+)"/)?.[1];
    expect(boundary).toBeTruthy();
    // Body text and the attachment's base64 payload both appear as separate parts.
    expect(raw).toContain("本文です");
    expect(raw).toContain("aGVsbG8=");
    expect(raw).toContain('Content-Disposition: attachment; filename="test.txt"');
    expect(raw).toContain("Content-Transfer-Encoding: base64");
    // The message ends with the closing boundary marker.
    expect(raw.trim().endsWith(`--${boundary}--`)).toBe(true);
  });

  it("wraps a long base64 attachment payload at 76 characters per line", () => {
    const longBase64 = "A".repeat(200);
    const raw = buildRawMessage(headers, "本文", [{ filename: "big.bin", mimeType: "application/octet-stream", base64Data: longBase64 }]);
    const wrappedLines = raw.split("\r\n").filter((line) => /^A+$/.test(line));
    expect(wrappedLines.every((line) => line.length <= 76)).toBe(true);
    expect(wrappedLines.join("")).toBe(longBase64);
  });

  it("includes multiple attachments as separate parts", () => {
    const raw = buildRawMessage(headers, "本文", [
      { filename: "a.txt", mimeType: "text/plain", base64Data: "YQ==" },
      { filename: "b.txt", mimeType: "text/plain", base64Data: "Yg==" },
    ]);
    expect(raw).toContain('filename="a.txt"');
    expect(raw).toContain('filename="b.txt"');
  });
});

describe("attachmentsTotalBytes", () => {
  it("sums the byte sizes of a list of files", () => {
    const files = [new File(["a".repeat(10)], "a.txt"), new File(["b".repeat(20)], "b.txt")];
    expect(attachmentsTotalBytes(files)).toBe(30);
  });

  it("returns 0 for an empty list", () => {
    expect(attachmentsTotalBytes([])).toBe(0);
  });
});

describe("mapWithConcurrency", () => {
  it("同時に走る本数を上限までに抑える", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let running = 0;
    let peak = 0;
    const done: number[] = [];

    await mapWithConcurrency(items, 3, async (item) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      done.push(item);
      running--;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(done.sort((a, b) => a - b)).toEqual(items);
  });

  it("空の配列でも止まらない", async () => {
    const run = vi.fn();
    await mapWithConcurrency([], 3, run);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("isUnhandledEmail", () => {
  it("重要を付けたものは「すべて」から外す(重要タブへ移す)", () => {
    // 押しても「すべて」に残っていると、移した実感が無い。
    expect(isUnhandledEmail({ status: "unprocessed", importantAt: 1_000 })).toBe(false);
    expect(isUnhandledEmail({ status: "unprocessed", importantAt: undefined })).toBe(true);
  });

  it("未読でまだ返信していないメールは残す", () => {
    expect(isUnhandledEmail({ status: "unprocessed" })).toBe(true);
    expect(isUnhandledEmail({ status: "drafted" })).toBe(true);
    expect(isUnhandledEmail({ status: "edited" })).toBe(true);
  });

  it("既読にしたメールは外す", () => {
    expect(isUnhandledEmail({ status: "unprocessed", readAt: 1_700_000_000_000 })).toBe(false);
  });

  it("返信を送ったメールは、未読のままでも外す", () => {
    expect(isUnhandledEmail({ status: "sent" })).toBe(false);
  });
});

describe("buildSyncSummary", () => {
  const none = {
    freshAdded: 0,
    handledElsewhere: 0,
    blockedAdded: 0,
    reconciled: 0,
    removed: 0,
    pushedStates: 0,
    pulledStates: 0,
    failed: 0,
    deferred: 0,
  };

  it("一覧に出る新着だけを「新着メール」として数える", () => {
    expect(buildSyncSummary({ ...none, freshAdded: 3 })).toBe("3件の新着メールしました");
  });

  // 実際に出た不具合(2026-08-24): 取り込んだ7件が全て他の端末で既読済みだったのに
  // 「7件の新着メール」と出て、一覧には何も増えていなかった。
  it("他の端末で処理済みの分は新着に数えず、理由を添える", () => {
    expect(buildSyncSummary({ ...none, handledElsewhere: 7 })).toBe(
      "新着メールはありませんでした(7件は他の端末で処理済み(既読・送信済みタブ))",
    );
  });

  it("ブロック中の送信者の分も新着に数えない", () => {
    expect(buildSyncSummary({ ...none, blockedAdded: 2 })).toBe(
      "新着メールはありませんでした(2件はブロック中の送信者)",
    );
  });

  it("新着と、出ない分が混ざる場合は両方を出す", () => {
    expect(buildSyncSummary({ ...none, freshAdded: 1, handledElsewhere: 4, blockedAdded: 2 })).toBe(
      "1件の新着メールしました(4件は他の端末で処理済み(既読・送信済みタブ)・2件はブロック中の送信者)",
    );
  });

  it("何も無ければこれまでどおりの文言", () => {
    expect(buildSyncSummary(none)).toBe("新着メールはありませんでした");
  });

  it("取得できなかった分・持ち越した分はこれまでどおり伝える", () => {
    expect(buildSyncSummary({ ...none, freshAdded: 2, failed: 1, deferred: 30 })).toBe(
      "2件の新着メール・1件は取得できず次回に持ち越し・残り30件は次回の同期で取り込みしました",
    );
  });
});

describe("describeGmailConnectError", () => {
  it("サーバーに接続情報が無い場合は、どの環境変数かまで伝える", () => {
    expect(describeGmailConnectError(new Error("Google OAuth is not configured on the server"))).toContain(
      "GOOGLE_CLIENT_ID",
    );
  });

  it("リダイレクトURIの不一致は、どこを見ればよいかまで伝える", () => {
    expect(describeGmailConnectError(new Error("Google token exchange failed: redirect_uri_mismatch"))).toContain(
      "リダイレクトURI",
    );
  });

  it("認証コードの期限切れは、やり直せばよいと伝える", () => {
    expect(describeGmailConnectError(new Error('{"error":"invalid_grant"}'))).toContain("もう一度やり直して");
  });

  it("テストユーザー未登録で断られた場合は、その設定を指す", () => {
    expect(describeGmailConnectError(new Error("access_denied"))).toContain("テストユーザー");
  });

  it("当てはまるものが無ければ、元のメッセージをそのまま出す", () => {
    // 知らない失敗を「連携に失敗しました」で潰すと、設定を直しようがなくなる。
    expect(describeGmailConnectError(new Error("Googleがrefresh_tokenを返しませんでした"))).toBe(
      "Googleがrefresh_tokenを返しませんでした",
    );
  });
});
