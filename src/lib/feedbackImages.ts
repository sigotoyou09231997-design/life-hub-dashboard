import { downscaleToJpegBlob } from "./imageDownscale";
import { fileToBase64 } from "./receiptScan";

/**
 * 修正依頼に付ける画像(スクリーンショットなど。supabase/sql/033_feedback_images.sql)。
 *
 * 画像は端末で縮めて JPEG にし、データ URL の文字として依頼の1行に入れる(保存領域は増やさない)。
 * 上限は SQL 側の決まりと同じ数字にしてある(送ってから断られないように、ここで先にそろえる)。
 */
export const FEEDBACK_MAX_IMAGES = 3;
/** 1枚の上限(データ URL の文字数)。約330KB。 */
export const FEEDBACK_IMAGE_MAX_CHARS = 450_000;
/** 3枚の合計の上限(データ URL の文字数)。 */
export const FEEDBACK_IMAGES_TOTAL_MAX_CHARS = 1_200_000;

/** 縮める長辺の候補。大きい方から試して、上限に収まった最初のものを使う(スクリーンショットは文字が読めればよい)。 */
const EDGES = [1280, 960, 720, 560];

export type FeedbackImageFailure = "not_image" | "unsupported" | "too_big" | "too_many";

export class FeedbackImageError extends Error {
  constructor(public readonly reason: FeedbackImageFailure) {
    super(FEEDBACK_IMAGE_FAILURE_MESSAGE[reason]);
    this.name = "FeedbackImageError";
  }
}

export const FEEDBACK_IMAGE_FAILURE_MESSAGE: Record<FeedbackImageFailure, string> = {
  not_image: "画像ではないファイルです",
  unsupported: "この画像は縮められませんでした。別の画像でお試しください",
  too_big: "画像が大きすぎます。画面の一部だけを撮るなどして、小さくしてください",
  too_many: `画像は${FEEDBACK_MAX_IMAGES}枚までです`,
};

/** 選んだ画像を、送れる大きさの JPEG のデータ URL にする。 */
export async function prepareFeedbackImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new FeedbackImageError("not_image");
  for (const edge of EDGES) {
    const blob = await downscaleToJpegBlob(file, edge);
    if (!blob) throw new FeedbackImageError("unsupported");
    const dataUrl = `data:image/jpeg;base64,${await fileToBase64(blob)}`;
    if (dataUrl.length <= FEEDBACK_IMAGE_MAX_CHARS) return dataUrl;
  }
  throw new FeedbackImageError("too_big");
}

/** 追加しても、枚数と合計の上限に収まるか。収まらなければ理由を返す。 */
export function checkFeedbackImagesFit(current: string[], added: string): FeedbackImageFailure | null {
  if (current.length >= FEEDBACK_MAX_IMAGES) return "too_many";
  const total = current.reduce((sum, image) => sum + image.length, 0) + added.length;
  return total > FEEDBACK_IMAGES_TOTAL_MAX_CHARS ? "too_big" : null;
}
