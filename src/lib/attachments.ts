import { db } from "../db/schema";
import type { Attachment, AttachmentOwnerType } from "../types";
import { downscaleToJpegBlob } from "./imageDownscale";

/**
 * メモ・日記に貼る写真。
 *
 * 写真そのものは attachments テーブル(端末内のみ)に置き、メモ・日記の行には
 * 何も足さない — notes と diaryEntries はSupabaseへ同期していて、行の中に写真を
 * 抱えると同期の1行が数MBになるため(types/index.ts の Attachment)。
 *
 * 保存は「メモ・日記を保存した後」に行う。新しく書いたメモにはまだidが無く、
 * 貼り先を決められないため、フォームは選んだ写真を下書き(PhotoDraft)として
 * 手元に持ち、保存で得たidに向けて saveAttachmentDrafts でまとめて書く。
 */

/** 1件のメモ・日記に貼れる枚数。端末の中に置く以上、無制限にはしない。 */
export const MAX_ATTACHMENTS_PER_ITEM = 8;

/** 選べる写真の元の大きさ(バイト)。縮める前に明らかに大きすぎるものを弾く。 */
export const MAX_ATTACHMENT_SOURCE_BYTES = 20 * 1024 * 1024;

/** 選べる形式。iPhoneの写真(HEIC)も、ブラウザが読めれば縮めた時点でJPEGになる。 */
export const SUPPORTED_ATTACHMENT_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];

/** フォームが手元に持つ写真1枚。id があるものは既に保存済み、無いものは
 * これから貼るもの。 */
export interface PhotoDraft {
  id?: string;
  name: string;
  mediaType: string;
  blob: Blob;
}

/** 選んだファイルが受け取れるものか。受け取れないときだけ理由の文を返す。 */
export function attachmentFileError(file: { type: string; size: number }): string | null {
  // 種類が空で来ることがある(HEICを古いブラウザが読めないときなど)。その場合は
  // 縮める段で弾かれるので、ここでは通す。
  if (file.type && !SUPPORTED_ATTACHMENT_MEDIA_TYPES.includes(file.type)) {
    return "対応していない形式です。写真(jpeg/png/webp)を選んでください。";
  }
  if (file.size > MAX_ATTACHMENT_SOURCE_BYTES) {
    return "写真が大きすぎます。もう少し小さい写真を選んでください。";
  }
  return null;
}

/** 何枚まで足せるか。上限に達していれば0。 */
export function remainingSlots(current: number): number {
  return Math.max(0, MAX_ATTACHMENTS_PER_ITEM - current);
}

/** 選ばれたファイルを、貼れる形(縮めたJPEG)の下書きにする。縮められない環境では
 * 元の写真をそのまま持つ — 貼れないより、大きいまま持つ方がよい。 */
export async function toPhotoDraft(file: File): Promise<PhotoDraft> {
  const downscaled = await downscaleToJpegBlob(file);
  if (downscaled) return { name: file.name, mediaType: "image/jpeg", blob: downscaled };
  return { name: file.name, mediaType: file.type || "image/jpeg", blob: file };
}

export function draftsFromAttachments(rows: Attachment[]): PhotoDraft[] {
  return sortAttachments(rows).map((row) => ({
    id: row.id,
    name: row.name,
    mediaType: row.mediaType,
    blob: row.blob,
  }));
}

/** 貼った順(古いものが先)。同時に貼った写真は順番が決まらないので、名前で揃える。 */
export function sortAttachments<T extends { createdAt: number; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name, "ja"));
}

/** 相手ごとにまとめる。一覧で1件ずつ引くと画面の行数だけ問い合わせが増えるので、
 * 種類ぶんを一度に読んでからここで配る。 */
export function groupByOwner(rows: Attachment[]): Map<string, Attachment[]> {
  const byOwner = new Map<string, Attachment[]>();
  for (const row of sortAttachments(rows)) {
    const list = byOwner.get(row.ownerId) ?? [];
    list.push(row);
    byOwner.set(row.ownerId, list);
  }
  return byOwner;
}

export async function loadAttachmentDrafts(
  ownerType: AttachmentOwnerType,
  ownerId: string,
): Promise<PhotoDraft[]> {
  return draftsFromAttachments(await db.attachments.where({ ownerType, ownerId }).toArray());
}

/**
 * 下書きの並びをそのまま保存する。手元から消された写真はテーブルからも消し、
 * まだidの無い写真は足す。既にあるものは触らない(同じ写真を貼り直さない)。
 */
export async function saveAttachmentDrafts(
  ownerType: AttachmentOwnerType,
  ownerId: string,
  drafts: PhotoDraft[],
): Promise<void> {
  const kept = new Set(drafts.map((draft) => draft.id).filter(Boolean) as string[]);
  const existing = await db.attachments.where({ ownerType, ownerId }).toArray();
  const removed = existing.filter((row) => row.id && !kept.has(row.id)).map((row) => row.id!);
  if (removed.length > 0) await db.attachments.bulkDelete(removed);

  const added = drafts.filter((draft) => !draft.id);
  if (added.length === 0) return;
  const now = Date.now();
  await db.attachments.bulkAdd(
    added.map((draft, index) => ({
      ownerType,
      ownerId,
      name: draft.name,
      mediaType: draft.mediaType,
      blob: draft.blob,
      size: draft.blob.size,
      // 貼った順を保てるよう、同時に足した写真にも1msずつずらした時刻を付ける。
      createdAt: now + index,
    })),
  );
}

/** メモ・日記そのものを消したときに、貼ってあった写真も落とす。 */
export async function deleteAttachmentsFor(ownerType: AttachmentOwnerType, ownerId: string): Promise<void> {
  await db.attachments.where({ ownerType, ownerId }).delete();
}

/** 何件かまとめて消すとき(旅行ごと消すなど)。 */
export async function deleteAttachmentsForAll(
  ownerType: AttachmentOwnerType,
  ownerIds: string[],
): Promise<void> {
  await Promise.all(ownerIds.map((ownerId) => deleteAttachmentsFor(ownerType, ownerId)));
}
