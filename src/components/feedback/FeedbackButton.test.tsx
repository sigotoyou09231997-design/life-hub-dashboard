/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../ui/ToastProvider";

const mocks = vi.hoisted(() => ({ sent: [] as unknown[], failWith: null as null | string, imagesAllowed: false }));

vi.mock("../../lib/appFeedback", async () => {
  const actual = await vi.importActual<typeof import("../../lib/appFeedback")>("../../lib/appFeedback");
  return {
    ...actual,
    canAttachImages: async () => mocks.imagesAllowed,
    sendFeedback: async (input: unknown) => {
      if (mocks.failWith) throw new actual.FeedbackError(mocks.failWith as never);
      mocks.sent.push(input);
    },
  };
});

// 画像を縮める本物は canvas が要るので、試験では名前から作った小さな JPEG のデータ URL にする。
vi.mock("../../lib/feedbackImages", async () => {
  const actual = await vi.importActual<typeof import("../../lib/feedbackImages")>("../../lib/feedbackImages");
  return {
    ...actual,
    prepareFeedbackImage: async (file: File) => {
      if (!file.type.startsWith("image/")) throw new actual.FeedbackImageError("not_image");
      return `data:image/jpeg;base64,${btoa(file.name)}`;
    },
  };
});

import { FeedbackButton } from "./FeedbackButton";

function renderButton(props: { shareToken?: string } = {}, path = "/trips/abc") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <FeedbackButton {...props} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.sent = [];
  mocks.failWith = null;
  mocks.imagesAllowed = false;
  window.localStorage.clear();
});
afterEach(cleanup);

describe("修正ボタン", () => {
  it("押すと書く欄が開き、いまの画面と一緒に送る", async () => {
    const user = userEvent.setup();
    renderButton();
    expect(screen.getByRole("button", { name: "直してほしいことを送る" }).textContent).toContain("修正");
    await user.click(screen.getByRole("button", { name: "直してほしいことを送る" }));
    expect(screen.getByText(/いま開いている画面\(\/trips\/abc\)も一緒に送ります/)).toBeTruthy();
    const send = screen.getByRole("button", { name: "送る" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.type(screen.getByPlaceholderText(/時刻を変えても/), "並び順が戻らない");
    await user.type(screen.getByPlaceholderText(/えっくん/), "友人A");
    await user.click(screen.getByRole("button", { name: "送る" }));
    expect(mocks.sent).toEqual([{ message: "並び順が戻らない", page: "/trips/abc", senderName: "友人A", shareToken: undefined }]);
    expect(await screen.findByText("送りました。ありがとうございます")).toBeTruthy();
    // 名乗りは次から最初から入っている。
    await user.click(screen.getByRole("button", { name: "直してほしいことを送る" }));
    expect((screen.getByPlaceholderText(/えっくん/) as HTMLInputElement).value).toBe("友人A");
  });

  it("共有したしおりのページでは、合鍵も一緒に送る", async () => {
    const user = userEvent.setup();
    renderButton({ shareToken: "tok" }, "/share/trip/tok");
    await user.click(screen.getByRole("button", { name: "直してほしいことを送る" }));
    await user.type(screen.getByPlaceholderText(/時刻を変えても/), "x");
    await user.click(screen.getByRole("button", { name: "送る" }));
    expect(mocks.sent).toEqual([expect.objectContaining({ shareToken: "tok", page: "/share/trip/tok" })]);
  });

  it("送れなかった理由を、閉じずにそのまま出す", async () => {
    mocks.failWith = "unavailable";
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole("button", { name: "直してほしいことを送る" }));
    await user.type(screen.getByPlaceholderText(/時刻を変えても/), "x");
    await user.click(screen.getByRole("button", { name: "送る" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/準備中/);
    expect(screen.getByRole("button", { name: "送る" })).toBeTruthy();
  });

  describe("画像を付ける(033 を流した後だけ)", () => {
    const png = (name: string) => new File(["x"], name, { type: "image/png" });

    async function open() {
      const user = userEvent.setup();
      renderButton();
      await user.click(screen.getByRole("button", { name: "直してほしいことを送る" }));
      return user;
    }

    it("033 を流す前は、「画像を付ける」を出さない(送ると失敗するため)", async () => {
      await open();
      expect(screen.queryByRole("button", { name: "画像を付ける" })).toBeNull();
    });

    it("流した後は、画像を付けて送れる(縮めた画像が一緒に送られる)", async () => {
      mocks.imagesAllowed = true;
      const user = await open();
      await user.click(await screen.findByRole("button", { name: "画像を付ける" }));
      await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, [png("a.png"), png("b.png")]);
      expect(await screen.findByAltText("付ける画像2")).toBeTruthy();
      await user.type(screen.getByPlaceholderText(/時刻を変えても/), "この画面です");
      await user.click(screen.getByRole("button", { name: "送る" }));
      expect(mocks.sent).toEqual([
        expect.objectContaining({ message: "この画面です", images: [`data:image/jpeg;base64,${btoa("a.png")}`, `data:image/jpeg;base64,${btoa("b.png")}`] }),
      ]);
    });

    it("付けた画像は1枚ずつ外せる。3枚そろったら、付けるボタンは出さない", async () => {
      mocks.imagesAllowed = true;
      const user = await open();
      await screen.findByRole("button", { name: "画像を付ける" });
      await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, [png("a.png"), png("b.png"), png("c.png")]);
      expect(await screen.findByAltText("付ける画像3")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "画像を付ける" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "画像2を外す" }));
      expect(screen.queryByAltText("付ける画像3")).toBeNull();
      expect(screen.getByRole("button", { name: "画像を付ける" })).toBeTruthy();
    });

    it("画像でないファイルや、4枚目は、理由を出して付けない", async () => {
      mocks.imagesAllowed = true;
      const user = await open();
      await screen.findByRole("button", { name: "画像を付ける" });
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      // user.upload は accept で画像以外を弾いてしまうので、選ばれた体で直接渡す(端末によっては画像以外も選べる)。
      fireEvent.change(input, { target: { files: [new File(["x"], "memo.txt", { type: "text/plain" })] } });
      expect((await screen.findByRole("alert")).textContent).toContain("画像ではない");
      await user.upload(input, [png("a.png"), png("b.png"), png("c.png"), png("d.png")]);
      expect((await screen.findByRole("alert")).textContent).toContain("3枚まで");
    });
  });
});
