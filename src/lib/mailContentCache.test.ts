import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailAccount } from "../types";

const mocks = vi.hoisted(() => ({
  ensureFreshAccessToken: vi.fn(),
  getMessageContent: vi.fn(),
}));
vi.mock("./gmail", () => ({
  ensureFreshAccessToken: mocks.ensureFreshAccessToken,
  getMessageContent: mocks.getMessageContent,
}));

import { clearMailContentCache, loadMailContent, prefetchMailContent } from "./mailContentCache";

const account = { id: "acc-1", email: "me@example.com" } as GmailAccount;
const other = { id: "acc-2", email: "you@example.com" } as GmailAccount;

function content(text: string, extra: Partial<{ html: string; images: Record<string, string> }> = {}) {
  return { text, html: extra.html ?? "", preferHtml: false, inlineImages: extra.images ?? {} };
}

beforeEach(() => {
  clearMailContentCache();
  vi.clearAllMocks();
  mocks.ensureFreshAccessToken.mockImplementation(async (a: GmailAccount) => ({ ...a, accessToken: "tok" }));
  mocks.getMessageContent.mockImplementation(async (_token: string, id: string) => content(`本文 ${id}`));
});

describe("メール本文の控え", () => {
  it("同じメールを開き直しても、Gmail には1回しか取りに行かない", async () => {
    const first = await loadMailContent(account, "m1");
    const second = await loadMailContent(account, "m1");
    expect(first.text).toBe("本文 m1");
    expect(second).toBe(first);
    expect(mocks.getMessageContent).toHaveBeenCalledTimes(1);
    expect(mocks.getMessageContent).toHaveBeenCalledWith("tok", "m1");
  });

  it("先読みしておいたメールを開くと、取っている最中でも新しく取りに行かずその結果を待つ", async () => {
    let release!: () => void;
    mocks.getMessageContent.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(content("遅い本文")))),
    );
    prefetchMailContent(account, "slow");
    const opening = loadMailContent(account, "slow");
    // トークンの確認(非同期)のあとで Gmail に取りに行くので、取りに行くまで待つ。
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    expect((await opening).text).toBe("遅い本文");
    expect(mocks.getMessageContent).toHaveBeenCalledTimes(1);
  });

  it("アカウントが違えば、同じ id でも別のメール", async () => {
    await loadMailContent(account, "m1");
    await loadMailContent(other, "m1");
    expect(mocks.getMessageContent).toHaveBeenCalledTimes(2);
  });

  it("取れなかった時は控えない。次に開いた時にもう一度取りに行く", async () => {
    mocks.getMessageContent.mockRejectedValueOnce(new Error("offline"));
    await expect(loadMailContent(account, "m1")).rejects.toThrow("offline");
    await Promise.resolve();
    const retry = await loadMailContent(account, "m1");
    expect(retry.text).toBe("本文 m1");
    expect(mocks.getMessageContent).toHaveBeenCalledTimes(2);
  });

  it("先読みが失敗しても、何も投げない(開いた時に普通に取りに行く)", async () => {
    mocks.getMessageContent.mockRejectedValueOnce(new Error("offline"));
    expect(() => prefetchMailContent(account, "m1")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await loadMailContent(account, "m1")).text).toBe("本文 m1");
  });

  it("空の id は先読みしない", () => {
    prefetchMailContent(account, "");
    expect(mocks.getMessageContent).not.toHaveBeenCalled();
  });

  it("31通目を控えると、いちばん使っていないものから捨てる。使ったものは残る", async () => {
    for (let i = 0; i < 30; i++) await loadMailContent(account, `m${i}`);
    await loadMailContent(account, "m0"); // m0 を使った(捨てる順番が後ろへ回る)
    await loadMailContent(account, "m30"); // 31通目 → m1 が捨てられる
    mocks.getMessageContent.mockClear();
    await loadMailContent(account, "m0");
    expect(mocks.getMessageContent).not.toHaveBeenCalled();
    await loadMailContent(account, "m1");
    expect(mocks.getMessageContent).toHaveBeenCalledTimes(1);
  });

  it("中身が大きすぎる分は、数が少なくても古いものから捨てる", async () => {
    const big = "x".repeat(5_000_000);
    mocks.getMessageContent.mockImplementation(async (_t: string, id: string) => content("本文", { html: id === "tiny" ? "" : big }));
    await loadMailContent(account, "big1");
    await loadMailContent(account, "big2"); // 合計 10M > 8M → big1 が捨てられる
    mocks.getMessageContent.mockClear();
    await loadMailContent(account, "big2");
    expect(mocks.getMessageContent).not.toHaveBeenCalled();
    await loadMailContent(account, "big1");
    expect(mocks.getMessageContent).toHaveBeenCalledTimes(1);
  });

  it("clearMailContentCache で全部忘れる(アカウントの解除時)", async () => {
    await loadMailContent(account, "m1");
    clearMailContentCache();
    await loadMailContent(account, "m1");
    expect(mocks.getMessageContent).toHaveBeenCalledTimes(2);
  });
});
