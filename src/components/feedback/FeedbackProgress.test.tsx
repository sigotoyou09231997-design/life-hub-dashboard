/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../ui/ToastProvider";
import type { FeedbackItem } from "../../lib/appFeedback";

const mocks = vi.hoisted(() => ({ recent: [] as FeedbackItem[], owner: false as boolean | undefined, answers: [] as [string, string][], answerError: null as Error | null }));

vi.mock("../../lib/appFeedback", async () => {
  const actual = await vi.importActual<typeof import("../../lib/appFeedback")>("../../lib/appFeedback");
  return {
    ...actual,
    canAttachImages: async () => false,
    loadRecentFeedback: async () => mocks.recent,
    answerFeedback: async (id: string, answer: string) => {
      if (mocks.answerError) throw mocks.answerError;
      mocks.answers.push([id, answer]);
    },
  };
});
vi.mock("../../hooks/useIsFeedbackOwner", () => ({ useIsFeedbackOwner: () => mocks.owner }));

import { FeedbackError, notifyFeedbackChanged } from "../../lib/appFeedback";
import { resetFeedbackProgressForTests } from "../../lib/feedbackProgress";
import { FeedbackButton, InAppFeedbackButton } from "./FeedbackButton";

const item = (id: string, status: FeedbackItem["status"], extra: Partial<FeedbackItem> = {}): FeedbackItem => ({
  id,
  via: "app",
  message: "ボタンが小さくて押しにくい",
  status,
  createdAt: "2026-10-13T03:00:00Z",
  ...extra,
});

function renderApp(ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/trips"]}>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetFeedbackProgressForTests();
  mocks.recent = [];
  mocks.owner = false;
  mocks.answers = [];
  mocks.answerError = null;
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  resetFeedbackProgressForTests();
});

describe("修正ボタンの「対応中」", () => {
  it("直してもらっている依頼が無い間は、いつもの「修正」", async () => {
    renderApp(<FeedbackButton />);
    const button = screen.getByRole("button", { name: "直してほしいことを送る" });
    expect(button.textContent).toBe("修正");
  });

  it("対応中の依頼がある間は、「対応中」に変わる。終わると「修正」に戻る", async () => {
    mocks.recent = [item("a", "working", { workingAt: "2026-10-13T03:10:00Z" })];
    renderApp(<FeedbackButton />);
    const button = await screen.findByRole("button", { name: /^対応中です/ });
    expect(button.textContent).toBe("対応中");

    mocks.recent = [item("a", "done")];
    await act(async () => notifyFeedbackChanged());
    await waitFor(() => expect(screen.getByRole("button", { name: "直してほしいことを送る" }).textContent).toBe("修正"));
  });

  it("対応待ちだけ(まだ手を付けていない)の間は、「対応中」にしない。ボタンに「対応待ち N件」と出る(2026-10-14、本人「対応待ち何件という表示も欲しい」)", async () => {
    mocks.recent = [item("a", "new"), item("b", "new"), item("c", "done")];
    renderApp(<FeedbackButton />);
    const button = await screen.findByRole("button", { name: "対応待ちの依頼が2件あります。直してほしいことを送る" });
    expect(button.textContent).toBe("対応待ち 2件");
    expect(screen.queryByText("対応中")).toBeNull();
  });

  it("対応中・保留中があっても、対応待ちの件数は一緒に出る。対応待ちが無ければ件数は出さない", async () => {
    mocks.recent = [item("a", "working", { workingAt: "2026-10-13T03:10:00Z" }), item("b", "new"), item("c", "new"), item("d", "new")];
    renderApp(<FeedbackButton />);
    const button = await screen.findByRole("button", { name: "対応中です。対応待ちの依頼が3件あります。直してほしいことを送る" });
    expect(button.textContent).toBe("対応中 ・ 対応待ち 3件");
    cleanup();
    resetFeedbackProgressForTests();
    mocks.recent = [item("a", "hold"), item("b", "new")];
    renderApp(<FeedbackButton />);
    expect((await screen.findByRole("button", { name: /^保留中の依頼があります。対応待ちの依頼が1件あります/ })).textContent).toBe("保留中 ・ 対応待ち 1件");
    cleanup();
    resetFeedbackProgressForTests();
    mocks.recent = [item("a", "working", { workingAt: "2026-10-13T03:10:00Z" })];
    renderApp(<FeedbackButton />);
    expect((await screen.findByRole("button", { name: /^対応中です/ })).textContent).toBe("対応中");
  });

  it("開くと、状況の一覧の上に、状態ごとの件数が出る(0件の状態は出さない)。終わっていない依頼は、新しい対応済みより先に並ぶ", async () => {
    const user = userEvent.setup();
    // 新しい順に、対応済みが6件・その後ろに古い対応待ちが1件。件数と一覧が食い違わないよう、終わっていないものを先に出す。
    mocks.recent = [
      ...Array.from({ length: 6 }, (_, i) => item(`d${i}`, "done", { message: `対応済みの依頼${i}` })),
      item("w", "new", { message: "古い対応待ちの依頼" }),
      item("k", "working", { workingAt: "2026-10-13T03:10:00Z", message: "対応中の依頼" }),
    ];
    renderApp(<FeedbackButton />);
    await user.click(await screen.findByRole("button", { name: /^対応中です/ }));
    const list = await screen.findByRole("region", { name: "送った依頼の状況" });
    expect(within(list).getByTestId("feedback-counts").textContent).toBe("対応待ち 1件 ・ 対応中 1件");
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0].textContent).toContain("古い対応待ちの依頼");
    expect(rows[1].textContent).toContain("対応中の依頼");
  });

  it("終わっていない依頼が1つも無ければ、件数は出さない", async () => {
    const user = userEvent.setup();
    mocks.recent = [item("a", "done")];
    renderApp(<FeedbackButton />);
    await user.click(await screen.findByRole("button", { name: "直してほしいことを送る" }));
    const list = await screen.findByRole("region", { name: "送った依頼の状況" });
    expect(within(list).queryByTestId("feedback-counts")).toBeNull();
  });

  it("開くと、送った依頼の状況が出る(対応待ち・対応中とその時刻・対応済み)", async () => {
    const user = userEvent.setup();
    mocks.recent = [
      item("a", "working", { workingAt: "2026-10-13T03:10:00Z", message: "地図が出ない" }),
      item("b", "new", { message: "文字が小さい" }),
      item("c", "done", { message: "色が見にくい" }),
    ];
    renderApp(<FeedbackButton />);
    await user.click(await screen.findByRole("button", { name: /^対応中です/ }));
    const list = await screen.findByRole("region", { name: "送った依頼の状況" });
    expect(list.textContent).toContain("地図が出ない");
    expect(list.textContent).toMatch(/\d+\/\d+ \d+:\d{2} から対応中/);
    expect(list.textContent).toContain("対応待ち");
    expect(list.textContent).toContain("対応済み");
  });

  it("何も送っていなければ、状況の一覧は出さない。共有ページ(ログインなし)にも出さない", async () => {
    const user = userEvent.setup();
    renderApp(<FeedbackButton />);
    await user.click(screen.getByRole("button", { name: "直してほしいことを送る" }));
    expect(screen.queryByRole("region", { name: "送った依頼の状況" })).toBeNull();
    cleanup();
    mocks.recent = [item("a", "working")];
    renderApp(<FeedbackButton shareToken="abc" standalone />);
    await user.click(await screen.findByRole("button", { name: /直してほしいことを送る/ }));
    expect(screen.queryByRole("region", { name: "送った依頼の状況" })).toBeNull();
  });
});

describe("いつ届いたか(2026-10-14、本人「いつ修正依頼が届いたかの時間も出して欲しい」)", () => {
  it("届いた時刻が出る。終わっていない依頼には、届いてからの経過も付く。対応済みには付けない", async () => {
    const user = userEvent.setup();
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    mocks.recent = [
      item("a", "new", { message: "待っている依頼", createdAt: ago(18) }),
      item("b", "working", { message: "直している依頼", createdAt: ago(125), workingAt: ago(5) }),
      item("c", "done", { message: "終わった依頼", createdAt: ago(3 * 24 * 60) }),
    ];
    renderApp(<FeedbackButton />);
    await user.click(await screen.findByRole("button", { name: /^対応中です/ }));
    const list = await screen.findByRole("region", { name: "送った依頼の状況" });
    const rows = within(list).getAllByRole("listitem");
    // 終わっていない依頼が先(古い順に並ぶのではなく、届いた順のまま)。
    expect(rows[0].textContent).toContain("待っている依頼");
    expect(rows[0].textContent).toMatch(/に届きました（18分前）/);
    expect(rows[1].textContent).toContain("直している依頼");
    expect(rows[1].textContent).toMatch(/\d+\/\d+ \d+:\d{2} に届きました（2時間前）\d+\/\d+ \d+:\d{2} から対応中/);
    expect(rows[2].textContent).toContain("終わった依頼");
    expect(rows[2].textContent).toMatch(/に届きました/);
    expect(rows[2].textContent).not.toMatch(/前）/);
  });
});

describe("かかる時間の目安とゲージ(2026-10-14、本人「どれくらいかかるか時間も出して、ゲージ表示もあると便利」)", () => {
  it("目安が付いた対応中の依頼には、ゲージと「目安 約○分」が出る。目安が無い依頼には出ない", async () => {
    const user = userEvent.setup();
    mocks.recent = [
      item("a", "working", { workingAt: new Date(Date.now() - 2 * 60_000).toISOString(), estimateMinutes: 6, message: "地図が出ない" }),
      item("b", "working", { workingAt: new Date(Date.now() - 2 * 60_000).toISOString(), message: "文字が小さい" }),
      item("c", "new", { estimateMinutes: 6, message: "色が見にくい" }),
    ];
    renderApp(<FeedbackButton />);
    await user.click(await screen.findByRole("button", { name: /^対応中です/ }));
    const list = await screen.findByRole("region", { name: "送った依頼の状況" });
    expect(list.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
    expect(list.textContent).toMatch(/目安 約6分・経過 [12]分・あと約[45]分/);
  });
});

describe("保留中(2026-10-14、本人「保留中というラベルをつけたい」)", () => {
  it("保留中の依頼があって、対応中が無い間は、ボタンが「保留中」になる", async () => {
    mocks.recent = [item("a", "hold", { statusNote: "どの画面か教えてください" })];
    renderApp(<FeedbackButton />);
    const button = await screen.findByRole("button", { name: /^保留中の依頼があります/ });
    expect(button.textContent).toBe("保留中");
  });

  it("対応中と保留中が両方あれば、対応中を先に出す", async () => {
    mocks.recent = [item("a", "hold"), item("b", "working")];
    renderApp(<FeedbackButton />);
    expect((await screen.findByRole("button", { name: /^対応中です/ })).textContent).toBe("対応中");
  });

  it("開くと、保留中の依頼に「保留中」の札と、理由(聞きたいこと)が出る", async () => {
    const user = userEvent.setup();
    mocks.recent = [item("a", "hold", { message: "ルートの候補を選びたい", statusNote: "どの「候補」のことか教えてください" }), item("b", "new", { message: "文字が小さい" })];
    renderApp(<FeedbackButton />);
    await user.click(await screen.findByRole("button", { name: /^保留中の依頼があります/ }));
    const list = await screen.findByRole("region", { name: "送った依頼の状況" });
    expect(list.textContent).toContain("保留中");
    expect(list.textContent).toContain("どの「候補」のことか教えてください");
    expect(list.textContent).toContain("対応待ち");
  });

  it("理由が無い保留中も、「保留中」の札だけは出る", async () => {
    const user = userEvent.setup();
    mocks.recent = [item("a", "hold", { message: "ルートの候補を選びたい" })];
    renderApp(<FeedbackButton />);
    await user.click(await screen.findByRole("button", { name: /^保留中の依頼があります/ }));
    const list = await screen.findByRole("region", { name: "送った依頼の状況" });
    expect(list.textContent).toContain("保留中");
  });
});

describe("持ち主の画面(2026-10-13、本人「修正を送るボタンが消えてる」)", () => {
  it("持ち主にも、アプリの「修正」ボタンを出す", async () => {
    mocks.owner = true;
    renderApp(<InAppFeedbackButton />);
    expect(screen.getByRole("button", { name: "直してほしいことを送る" }).textContent).toBe("修正");
  });

  it("持ち主でない人にも、持ち主かまだ分からない間も、出す", async () => {
    mocks.owner = false;
    renderApp(<InAppFeedbackButton />);
    expect(screen.getByRole("button", { name: "直してほしいことを送る" })).toBeTruthy();
    cleanup();
    mocks.owner = undefined;
    renderApp(<InAppFeedbackButton />);
    expect(screen.getByRole("button", { name: "直してほしいことを送る" })).toBeTruthy();
  });

  it("持ち主の「修正」も、誰かの依頼を直している間は「対応中」になる。開くと、届いている依頼の状況が出る", async () => {
    const user = userEvent.setup();
    mocks.owner = true;
    mocks.recent = [item("a", "working", { workingAt: "2026-10-13T03:10:00Z", message: "地図が出ない" }), item("b", "new", { message: "文字が小さい" })];
    renderApp(<InAppFeedbackButton />);
    const button = await screen.findByRole("button", { name: /^対応中です/ });
    expect(button.textContent).toBe("対応中 ・ 対応待ち 1件");
    await user.click(button);
    const list = await screen.findByRole("region", { name: "届いている依頼の状況" });
    expect(list.textContent).toContain("地図が出ない");
    expect(list.textContent).toContain("文字が小さい");
    expect(screen.queryByRole("region", { name: "送った依頼の状況" })).toBeNull();
  });
});

describe("保留中の質問に、ボタンで答える(2026-10-14、持ち主「質問者がボタンを押したらその回答がこっちに送信されるように」)", () => {
  const asking = (extra: Partial<FeedbackItem> = {}) =>
    item("q", "hold", { message: "ルートは日程の横がいい", statusNote: "どの「横」ですか?", questionOptions: ["PCで左右に並べる", "スマホでも日程の下に出す"], ...extra });

  async function openList() {
    const user = userEvent.setup();
    renderApp(<FeedbackButton />);
    await user.click(await screen.findByRole("button", { name: /^保留中の依頼があります/ }));
    return { user, list: await screen.findByRole("region", { name: "送った依頼の状況" }) };
  }

  it("保留中で選択肢が付いた依頼に、質問の文と、選択肢のボタンが出る。押すと、依頼の id と答えが送られる", async () => {
    mocks.recent = [asking()];
    const { user, list } = await openList();
    expect(list.textContent).toContain("どの「横」ですか?");
    const group = within(list).getByRole("group", { name: "質問への答え" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["PCで左右に並べる", "スマホでも日程の下に出す"]);
    await user.click(within(group).getByRole("button", { name: "スマホでも日程の下に出す" }));
    await waitFor(() => expect(mocks.answers).toEqual([["q", "スマホでも日程の下に出す"]]));
  });

  it("押している間は、ほかのボタンも押せない(二重に送らない)。失敗したら、理由を出して、もう一度押せる", async () => {
    mocks.recent = [asking()];
    mocks.answerError = new FeedbackError("failed");
    const { user, list } = await openList();
    await user.click(within(list).getByRole("button", { name: "PCで左右に並べる" }));
    expect((await within(list).findByRole("alert")).textContent).toContain("送れませんでした");
    expect((within(list).getByRole("button", { name: "PCで左右に並べる" }) as HTMLButtonElement).disabled).toBe(false);
    mocks.answerError = null;
    await user.click(within(list).getByRole("button", { name: "PCで左右に並べる" }));
    await waitFor(() => expect(mocks.answers).toEqual([["q", "PCで左右に並べる"]]));
  });

  it("選択肢が無い保留中(質問なし)にはボタンを出さない。答えたあと(対応待ちに戻った)は、何と答えたかを出す", async () => {
    mocks.recent = [item("h", "hold", { message: "質問なしの保留", statusNote: "少し待ってください" }), item("a", "new", { message: "答え済み", answer: "PCで左右に並べる", questionOptions: ["PCで左右に並べる", "別"] })];
    const { list } = await openList();
    expect(within(list).queryByRole("group", { name: "質問への答え" })).toBeNull();
    expect(list.textContent).toContain("あなたの答え: PCで左右に並べる");
  });
});
