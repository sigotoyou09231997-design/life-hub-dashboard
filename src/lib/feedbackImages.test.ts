import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sizes: [] as number[], edges: [] as number[] }));

// 縮める本物は canvas が要るので、試験では指定した大きさの Blob を返す(上限に収まるまで小さくなっていくか見る)。
vi.mock("./imageDownscale", () => ({
  downscaleToJpegBlob: async (_file: Blob, edge: number) => {
    mocks.edges.push(edge);
    const size = mocks.sizes.shift();
    return size === undefined ? null : new Blob(["A".repeat(size)]);
  },
}));
vi.mock("./receiptScan", () => ({
  fileToBase64: async (blob: Blob) => "A".repeat(blob.size),
}));

import {
  checkFeedbackImagesFit,
  FEEDBACK_IMAGE_MAX_CHARS,
  FEEDBACK_IMAGES_TOTAL_MAX_CHARS,
  FEEDBACK_MAX_IMAGES,
  prepareFeedbackImage,
} from "./feedbackImages";

const image = (name = "a.png") => new File(["x"], name, { type: "image/png" });

beforeEach(() => {
  mocks.sizes = [];
  mocks.edges = [];
});

describe("prepareFeedbackImage", () => {
  it("上限に収まった最初の大きさで、JPEG のデータ URL にする", async () => {
    mocks.sizes = [FEEDBACK_IMAGE_MAX_CHARS + 1000, 1000];
    const url = await prepareFeedbackImage(image());
    expect(url).toBe(`data:image/jpeg;base64,${"A".repeat(1000)}`);
    // 1280 で大きすぎたので、次の 960 で収まった。
    expect(mocks.edges).toEqual([1280, 960]);
  });

  it("どこまで縮めても収まらなければ、大きすぎると断る", async () => {
    mocks.sizes = [FEEDBACK_IMAGE_MAX_CHARS * 2, FEEDBACK_IMAGE_MAX_CHARS * 2, FEEDBACK_IMAGE_MAX_CHARS * 2, FEEDBACK_IMAGE_MAX_CHARS * 2];
    await expect(prepareFeedbackImage(image())).rejects.toMatchObject({ reason: "too_big" });
    expect(mocks.edges).toEqual([1280, 960, 720, 560]);
  });

  it("画像でないファイルは断る。縮められない画像は、そう伝える", async () => {
    await expect(prepareFeedbackImage(new File(["x"], "memo.txt", { type: "text/plain" }))).rejects.toMatchObject({ reason: "not_image" });
    mocks.sizes = []; // 縮める部品が null を返す
    await expect(prepareFeedbackImage(image())).rejects.toMatchObject({ reason: "unsupported" });
  });
});

describe("checkFeedbackImagesFit", () => {
  it("3枚を超える追加と、合計が上限を超える追加は、理由を返す", () => {
    expect(checkFeedbackImagesFit([], "x".repeat(100))).toBeNull();
    expect(checkFeedbackImagesFit(Array(FEEDBACK_MAX_IMAGES).fill("x"), "x")).toBe("too_many");
    const big = "x".repeat(FEEDBACK_IMAGES_TOTAL_MAX_CHARS - 10);
    expect(checkFeedbackImagesFit([big], "x".repeat(11))).toBe("too_big");
    expect(checkFeedbackImagesFit([big], "x".repeat(10))).toBeNull();
  });
});
