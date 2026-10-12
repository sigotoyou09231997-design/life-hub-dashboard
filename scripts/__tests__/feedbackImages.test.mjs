import { describe, expect, it } from "vitest";
import { decodeJpegDataUrl } from "../feedbackImages.mjs";

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64");

describe("decodeJpegDataUrl", () => {
  it("JPEG のデータ URL だけをバイト列にする", () => {
    const bytes = decodeJpegDataUrl(`data:image/jpeg;base64,${JPEG_HEAD}`);
    expect(bytes?.[0]).toBe(0xff);
    expect(bytes?.length).toBe(6);
  });

  it("別の種類・JPEG の頭が無いもの・大きすぎるもの・文字列でないものは捨てる", () => {
    expect(decodeJpegDataUrl(`data:image/png;base64,${JPEG_HEAD}`)).toBeNull();
    expect(decodeJpegDataUrl(`data:text/html;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`)).toBeNull();
    expect(decodeJpegDataUrl(`data:image/jpeg;base64,${Buffer.from("not a jpeg at all").toString("base64")}`)).toBeNull();
    expect(decodeJpegDataUrl(`data:image/jpeg;base64,${"A".repeat(450_000)}`)).toBeNull();
    expect(decodeJpegDataUrl(123)).toBeNull();
    expect(decodeJpegDataUrl(undefined)).toBeNull();
  });
});
