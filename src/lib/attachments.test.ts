// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Attachment } from "../types";
import {
  MAX_ATTACHMENTS_PER_ITEM,
  MAX_ATTACHMENT_SOURCE_BYTES,
  attachmentFileError,
  draftsFromAttachments,
  groupByOwner,
  remainingSlots,
  sortAttachments,
} from "./attachments";

function row(overrides: Partial<Attachment>): Attachment {
  return {
    id: "a1",
    ownerType: "note",
    ownerId: "n1",
    name: "photo.jpg",
    mediaType: "image/jpeg",
    blob: new Blob(["x"], { type: "image/jpeg" }),
    size: 1,
    createdAt: 0,
    ...overrides,
  };
}

describe("attachmentFileError", () => {
  it("写真なら受け取る", () => {
    expect(attachmentFileError({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(attachmentFileError({ type: "image/heic", size: 1000 })).toBeNull();
  });

  it("写真でないものは断る", () => {
    expect(attachmentFileError({ type: "application/pdf", size: 1000 })).toContain("対応していない形式");
  });

  it("種類が空のファイルは通す(縮める段で弾かれる)", () => {
    // HEICを読めないブラウザは type を空で渡してくることがある。
    expect(attachmentFileError({ type: "", size: 1000 })).toBeNull();
  });

  it("大きすぎる写真は断る", () => {
    expect(attachmentFileError({ type: "image/jpeg", size: MAX_ATTACHMENT_SOURCE_BYTES + 1 })).toContain("大きすぎます");
  });
});

describe("remainingSlots", () => {
  it("上限までの残り枚数を返す", () => {
    expect(remainingSlots(0)).toBe(MAX_ATTACHMENTS_PER_ITEM);
    expect(remainingSlots(MAX_ATTACHMENTS_PER_ITEM)).toBe(0);
  });

  it("上限を超えていてもマイナスにはしない", () => {
    expect(remainingSlots(MAX_ATTACHMENTS_PER_ITEM + 3)).toBe(0);
  });
});

describe("sortAttachments", () => {
  it("貼った順(古いものが先)に並べる", () => {
    const sorted = sortAttachments([row({ id: "b", createdAt: 2 }), row({ id: "a", createdAt: 1 })]);
    expect(sorted.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("同時に貼った写真は名前で揃える(並びが毎回変わらないように)", () => {
    const sorted = sortAttachments([
      row({ id: "b", createdAt: 5, name: "b.jpg" }),
      row({ id: "a", createdAt: 5, name: "a.jpg" }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("groupByOwner", () => {
  it("メモ・日記ごとにまとめる", () => {
    const grouped = groupByOwner([
      row({ id: "a", ownerId: "n1", createdAt: 1 }),
      row({ id: "b", ownerId: "n2", createdAt: 2 }),
      row({ id: "c", ownerId: "n1", createdAt: 3 }),
    ]);
    expect(grouped.get("n1")?.map((r) => r.id)).toEqual(["a", "c"]);
    expect(grouped.get("n2")?.map((r) => r.id)).toEqual(["b"]);
    expect(grouped.get("n3")).toBeUndefined();
  });
});

describe("draftsFromAttachments", () => {
  it("保存済みの写真は id を持った下書きになる(貼り直さないための印)", () => {
    const drafts = draftsFromAttachments([row({ id: "a", createdAt: 2 }), row({ id: "b", createdAt: 1 })]);
    expect(drafts.map((d) => d.id)).toEqual(["b", "a"]);
    expect(drafts[0]).toMatchObject({ name: "photo.jpg", mediaType: "image/jpeg" });
  });
});
