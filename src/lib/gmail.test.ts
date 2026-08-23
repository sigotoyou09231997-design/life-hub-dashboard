import { describe, expect, it, vi } from "vitest";
import {
  attachmentsTotalBytes,
  base64UrlDecode,
  base64UrlEncode,
  buildRawMessage,
  encodeHeaderWord,
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
