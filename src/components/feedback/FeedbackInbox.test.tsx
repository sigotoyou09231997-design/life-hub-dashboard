/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../ui/ToastProvider";
import type { FeedbackItem } from "../../lib/appFeedback";

const mocks = vi.hoisted(() => ({
  owner: false,
  items: [] as FeedbackItem[],
  changed: [] as [string, string][],
  images: {} as Record<string, string[]>,
  imageLoads: [] as string[],
}));

vi.mock("../../lib/appFeedback", async () => {
  const actual = await vi.importActual<typeof import("../../lib/appFeedback")>("../../lib/appFeedback");
  return {
    ...actual,
    loadIsFeedbackOwner: async () => mocks.owner,
    loadFeedback: async () => mocks.items,
    loadFeedbackImages: async (id: string) => {
      mocks.imageLoads.push(id);
      return mocks.images[id] ?? [];
    },
    setFeedbackStatus: async (id: string, status: string) => void mocks.changed.push([id, status]),
  };
});

import { FeedbackInbox } from "./FeedbackInbox";

function item(overrides: Partial<FeedbackItem>): FeedbackItem {
  return { id: "f1", via: "app", message: "ボタンが小さい", status: "new", createdAt: "2026-10-11T03:00:00Z", ...overrides };
}

function renderInbox() {
  render(
    <ToastProvider>
      <FeedbackInbox />
    </ToastProvider>,
  );
}

beforeEach(() => {
  mocks.owner = false;
  mocks.items = [];
  mocks.changed = [];
  mocks.images = {};
  mocks.imageLoads = [];
});
afterEach(cleanup);

describe("届いた要望", () => {
  it("持ち主でなければ、何も出さない", async () => {
    mocks.items = [item({})];
    renderInbox();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("届いた要望")).toBeNull();
  });

  it("持ち主には、対応待ちの要望を誰から・どの画面かと一緒に並べる", async () => {
    mocks.owner = true;
    mocks.items = [
      item({ id: "a", senderName: "友人A", page: "/trips/x", message: "並び順が戻らない" }),
      item({ id: "b", via: "share", tripName: "四国旅行", message: "しおりの時刻が違う" }),
      item({ id: "c", status: "done", message: "直したもの" }),
    ];
    renderInbox();
    expect(await screen.findByText("対応待ち 2件")).toBeTruthy();
    expect(screen.getByText("並び順が戻らない")).toBeTruthy();
    expect(screen.getByText(/友人A ・ \/trips\/x/)).toBeTruthy();
    expect(screen.getByText(/しおりを見た人\(「四国旅行」のしおりから\)/)).toBeTruthy();
    expect(screen.queryByText("直したもの")).toBeNull();
  });

  it("いつ届いたかが出る。まだ終わっていない依頼には、届いてからの経過も付く(2026-10-14)", async () => {
    mocks.owner = true;
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    mocks.items = [
      item({ id: "a", message: "待っている依頼", createdAt: ago(18) }),
      item({ id: "b", status: "done", message: "終わった依頼", createdAt: ago(18) }),
    ];
    const user = userEvent.setup();
    renderInbox();
    expect(await screen.findByText(/に届きました（18分前）/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "対応済み・見送りも見る" }));
    // 終わった依頼は、届いた時刻だけ(「○分前」は付けない)。
    expect(screen.getAllByText(/に届きました/)).toHaveLength(2);
    expect(screen.getAllByText(/に届きました（/)).toHaveLength(1);
  });

  it("対応済みにすると一覧から外れ、「対応済みも見る」で見られる", async () => {
    mocks.owner = true;
    mocks.items = [item({ id: "a", message: "並び順が戻らない" })];
    const user = userEvent.setup();
    renderInbox();
    await user.click(await screen.findByRole("button", { name: "対応済みにする" }));
    expect(mocks.changed).toEqual([["a", "done"]]);
    await waitFor(() => expect(screen.queryByText("並び順が戻らない")).toBeNull());
    await user.click(screen.getByRole("button", { name: "対応済み・見送りも見る" }));
    expect(screen.getByText("並び順が戻らない")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "対応待ちに戻す" }));
    expect(mocks.changed).toEqual([["a", "done"], ["a", "new"]]);
  });

  it("画像が付いている要望は、枚数だけ出して、押した時に読み込んで見せる(一覧では読み込まない)", async () => {
    mocks.owner = true;
    mocks.items = [item({ id: "a", message: "この画面です", imageCount: 2 }), item({ id: "b", message: "文字だけ" })];
    mocks.images = { a: ["data:image/jpeg;base64,AAAA", "data:image/jpeg;base64,BBBB"] };
    const user = userEvent.setup();
    renderInbox();
    await screen.findByText("この画面です");
    expect(mocks.imageLoads).toEqual([]);
    expect(screen.getAllByRole("button", { name: /画像を見る/ })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "画像を見る(2枚)" }));
    expect((await screen.findByAltText("付いている画像1")).getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
    expect(screen.getByAltText("付いている画像2")).toBeTruthy();
    expect(mocks.imageLoads).toEqual(["a"]);
    // 押すと大きくなり、もう一度で戻る。「画像を閉じる」で畳める。
    await user.click(screen.getByRole("button", { name: "画像1を大きくする" }));
    expect(screen.getByRole("button", { name: "画像1を小さくする" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "画像を閉じる" }));
    expect(screen.queryByAltText("付いている画像1")).toBeNull();
  });
});

describe("対応中(035)", () => {
  beforeEach(() => {
    mocks.owner = true;
  });

  it("対応中の依頼は、対応待ちと同じく既定の一覧に出て、いつから直しているかと「対応中 N件」が見える", async () => {
    mocks.items = [
      item({ id: "w1", message: "地図が出ない", status: "working", workingAt: "2026-10-13T03:10:00Z" }),
      item({ id: "n1", message: "文字が小さい", status: "new" }),
      item({ id: "d1", message: "もう直した", status: "done" }),
    ];
    renderInbox();
    expect(await screen.findByText("地図が出ない")).toBeTruthy();
    expect(screen.getByText("文字が小さい")).toBeTruthy();
    expect(screen.queryByText("もう直した")).toBeNull();
    expect(screen.getByText("対応中 1件")).toBeTruthy();
    expect(screen.getByText("対応待ち 1件")).toBeTruthy();
    expect(screen.getByText(/対応中（\d+:\d{2}から）/)).toBeTruthy();
  });

  it("対応中の依頼は、対応済みにする・対応待ちに戻す、ができる", async () => {
    const user = userEvent.setup();
    mocks.items = [item({ id: "w1", message: "地図が出ない", status: "working" })];
    renderInbox();
    await screen.findByText("地図が出ない");
    await user.click(screen.getByRole("button", { name: "対応済みにする" }));
    await waitFor(() => expect(mocks.changed).toEqual([["w1", "done"]]));
  });

  it("対応中を未対応に戻せる(止めた時に「対応中」のまま嘘にならないように)", async () => {
    const user = userEvent.setup();
    mocks.items = [item({ id: "w1", message: "地図が出ない", status: "working" })];
    renderInbox();
    await screen.findByText("地図が出ない");
    await user.click(screen.getByRole("button", { name: "対応待ちに戻す" }));
    await waitFor(() => expect(mocks.changed).toEqual([["w1", "new"]]));
  });
});

describe("保留中(036)", () => {
  beforeEach(() => {
    mocks.owner = true;
  });

  it("保留中の依頼は、既定の一覧に出て、理由と「保留中 N件」が見える。対応済み・対応待ちに戻す・見送るができる", async () => {
    const user = userEvent.setup();
    mocks.items = [item({ id: "h1", message: "ルートの候補を選びたい", status: "hold", statusNote: "どの「候補」のことか教えてください" }), item({ id: "d1", message: "もう直した", status: "done" })];
    renderInbox();
    expect(await screen.findByText("ルートの候補を選びたい")).toBeTruthy();
    expect(screen.queryByText("もう直した")).toBeNull();
    expect(screen.getByText("保留中 1件")).toBeTruthy();
    expect(screen.getByText(/保留の理由: どの「候補」のことか教えてください/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "対応待ちに戻す" }));
    await waitFor(() => expect(mocks.changed).toEqual([["h1", "new"]]));
    await user.click(screen.getByRole("button", { name: "見送る" }));
    await waitFor(() => expect(mocks.changed.at(-1)).toEqual(["h1", "dismissed"]));
  });

  it("理由が無い保留中は、札だけ出る", async () => {
    mocks.items = [item({ id: "h1", message: "相談", status: "hold" })];
    renderInbox();
    await screen.findByText("相談");
    expect(screen.queryByText(/保留の理由/)).toBeNull();
    expect(screen.getAllByText("保留中").length).toBeGreaterThan(0);
  });
});

describe("質問(選ぶボタン)と答え(2026-10-14)", () => {
  it("質問を送って返事を待つ依頼には、選択肢を出す。答えが届いた依頼には、答えを出す", async () => {
    mocks.owner = true;
    mocks.items = [
      item({ id: "w", status: "hold", message: "待っている", statusNote: "どれ?", questionOptions: ["A案", "B案"] }),
      item({ id: "r", status: "new", message: "答えが届いた", answer: "B案", questionOptions: ["A案", "B案"] }),
    ];
    renderInbox();
    expect(await screen.findByText(/選択肢\(返事待ち\): A案 \/ B案/)).toBeTruthy();
    expect(screen.getByText("答え: B案")).toBeTruthy();
  });
});
