// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractReceiptFromImage, fileToBase64 } from "./receiptScan";

describe("fileToBase64", () => {
  it("データURLの接頭辞を除いた生base64を返す", async () => {
    const file = new File(["hello"], "receipt.txt", { type: "text/plain" });
    const base64 = await fileToBase64(file);
    expect(base64).toBe(btoa("hello"));
  });
});

describe("extractReceiptFromImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("読み取れた内容をそのまま返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ receipt: { storeName: "いつものスーパー", amount: 1234 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const receipt = await extractReceiptFromImage("base64データ", "image/jpeg", "2026-08-27");

    expect(receipt).toEqual({ storeName: "いつものスーパー", amount: 1234 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/extractReceipt",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ imageBase64: "base64データ", mediaType: "image/jpeg", today: "2026-08-27" }),
      }),
    );
  });

  it("読み取れなかった(receipt: null)場合はnullを返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ receipt: null }) }));
    expect(await extractReceiptFromImage("x", "image/jpeg", "2026-08-27")).toBeNull();
  });

  it("サーバーのエラーメッセージをそのまま例外にする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "画像が大きすぎます" }) }),
    );
    await expect(extractReceiptFromImage("x", "image/jpeg", "2026-08-27")).rejects.toThrow("画像が大きすぎます");
  });

  it("サーバーからのJSONでない応答は、汎用のメッセージにする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => { throw new Error("not json"); } }),
    );
    await expect(extractReceiptFromImage("x", "image/jpeg", "2026-08-27")).rejects.toThrow("レシートの読み取りに失敗しました");
  });
});
