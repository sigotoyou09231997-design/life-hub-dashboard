import { fileToBase64 } from "./receiptScan";

/** 写真を、サーバーへ送れる大きさに縮める。
 *
 * スマホで撮った写真はそのままだと1枚4〜8MBあり、複数枚まとめて送ると
 * サーバー側(Vercel/Netlifyの関数)が受け取れる本文の大きさを超えて、
 * 読み取りに行く前に失敗する。旅程表やチケットの文字は長辺1600pxもあれば
 * 読めるので、送る前にここで縮める。
 *
 * 縮められない環境(canvasが使えない等)では、元の写真をそのまま返す —
 * 読み取れないよりは、大きいまま送って試す方がよい。 */

/** 縮めた後の長辺の上限。文字が読める最小限を狙う(大きいほど読み取りは
 * 良くなるが、送る量と待ち時間が増える)。 */
export const MAX_IMAGE_EDGE = 1600;

/** JPEGの品質。0.8前後より下げると小さい文字がつぶれる。 */
const JPEG_QUALITY = 0.82;

export interface ScannedImage {
  /** データURLの接頭辞を含まない生のbase64。 */
  base64: string;
  mediaType: string;
}

/** 長辺が max に収まる大きさを返す。元から小さい写真は拡大しない。 */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return { width: 0, height: 0 };
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  // 0pxのcanvasは描画できないので、どちらの辺も最低1pxは残す。
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * 縮めた画像をJPEGのBlobで返す。縮められなければ null(呼び出し側で元の写真を使う)。
 * AIに送るとき(下の prepareImageForScan)と、メモ・日記に貼って端末内に持つとき
 * (src/lib/attachments.ts)の両方がここを通る — 縮め方を1か所にしておかないと、
 * 片方だけ元の大きさのまま保存する、といったずれが出る。
 */
export async function downscaleToJpegBlob(file: Blob, maxEdge: number = MAX_IMAGE_EDGE): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, maxEdge);
    if (size.width === 0 || size.height === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

/** 縮めた画像をJPEGで返す。縮められなければ null(呼び出し側で元の写真を使う)。 */
async function toDownscaledJpeg(file: File): Promise<ScannedImage | null> {
  const blob = await downscaleToJpegBlob(file);
  if (!blob) return null;
  return { base64: await fileToBase64(blob), mediaType: "image/jpeg" };
}

/** 選ばれた写真を、そのまま送れる形にして返す。 */
export async function prepareImageForScan(file: File): Promise<ScannedImage> {
  const downscaled = await toDownscaledJpeg(file);
  if (downscaled) return downscaled;
  return { base64: await fileToBase64(file), mediaType: file.type };
}
