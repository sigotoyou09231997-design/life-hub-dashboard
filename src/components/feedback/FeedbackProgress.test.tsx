/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../ui/ToastProvider";
import type { FeedbackItem } from "../../lib/appFeedback";

const mocks = vi.hoisted(() => ({ recent: [] as FeedbackItem[], owner: false as boolean | undefined }));

vi.mock("../../lib/appFeedback", async () => {
  const actual = await vi.importActual<typeof import("../../lib/appFeedback")>("../../lib/appFeedback");
  return {
    ...actual,
    canAttachImages: async () => false,
    loadRecentFeedback: async () => mocks.recent,
  };
});
vi.mock("../../hooks/useIsFeedbackOwner", () => ({ useIsFeedbackOwner: () => mocks.owner }));

import { notifyFeedbackChanged } from "../../lib/appFeedback";
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
