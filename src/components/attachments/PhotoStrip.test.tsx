/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Attachment } from "../../types";
import { PhotoStrip } from "./PhotoStrip";

/** jsdom には createObjectURL が無い。作った数と取り消した数を数えて、
 * 貼った写真ぶんのURLが後片付けされることまで見る。 */
const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  let seq = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => {
      const url = `blob:photo-${seq++}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function photo(id: string, name = `${id}.jpg`): Attachment {
  return {
    id,
    ownerType: "diary",
    ownerId: "d1",
    name,
    mediaType: "image/jpeg",
    blob: new Blob(["x"], { type: "image/jpeg" }),
    size: 1,
    createdAt: 0,
  };
}

describe("PhotoStrip", () => {
  it("写真が無ければ何も出さない", () => {
    const { container } = render(<PhotoStrip attachments={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("貼ってある写真を並べる", () => {
    render(<PhotoStrip attachments={[photo("a"), photo("b")]} />);
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("並べる枚数を超えたぶんは「+n」として重ねる", () => {
    render(<PhotoStrip attachments={[photo("a"), photo("b"), photo("c"), photo("d")]} limit={2} />);
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByText("+2")).toBeTruthy();
  });

  it("押せる形のときだけ、押すと大きく見られる", () => {
    render(<PhotoStrip attachments={[photo("a", "レシート.jpg")]} interactive />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "レシート.jpgを大きく見る" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("押せない形(メモの一覧)では、写真そのものはボタンにしない", () => {
    // カード全体が編集ボタンなので、押しても編集が開いてしまう。
    render(<PhotoStrip attachments={[photo("a")]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("外したときにURLを取り消す(貼るたびに増え続けないように)", () => {
    const { unmount } = render(<PhotoStrip attachments={[photo("a"), photo("b")]} />);
    expect(created).toHaveLength(2);
    unmount();
    expect(revoked).toEqual(created);
  });
});
