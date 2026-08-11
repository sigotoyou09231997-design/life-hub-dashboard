import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode, encodeHeaderWord } from "./gmail";

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
