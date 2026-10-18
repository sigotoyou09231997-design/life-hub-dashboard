/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { GmailAccount, SyncedEmail } from "../../types";
import { ToastProvider } from "../ui/ToastProvider";

const mocks = vi.hoisted(() => ({
  emails: [] as Record<string, unknown>[],
  syncCalls: 0,
  /** 同期に渡された種類("full" か "quick")。 */
  syncModes: [] as string[],
  /** 返信待ちの判定そのものは src/lib/replyWaiting.test.ts で見る。ここでは結果だけ渡す。 */
  replyWaiting: [] as { email: Record<string, unknown>; sentAt: number; waitingDays: number }[],
  /** 既読にした・重要にした等(updateMessageState)の呼び出し。 */
  stateUpdates: [] as { id: unknown; patch: unknown }[],
}));

vi.mock("../../hooks/useReplyWaiting", () => ({
  useReplyWaiting: () => mocks.replyWaiting,
}));

vi.mock("../../db/schema", () => ({
  db: {
    syncedEmails: {
      where: () => ({
        equals: () => ({ reverse: () => ({ sortBy: async () => mocks.emails }) }),
      }),
      get: async (id: string) => mocks.emails.find((e) => e.id === id),
    },
    blockedSenders: {
      where: () => ({ equals: () => ({ toArray: async () => [] }) }),
    },
  },
}));

// useLiveQuery は本物のDexieテーブルを相手にしないと値を返さない。ここで見たいのは
// 画面の組み立てなので、問い合わせ関数を1回実行するだけの最小版に差し替える
// (src/components/gmail/MailPlanImport.test.tsx と同じ)。
vi.mock("dexie-react-hooks", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useLiveQuery: (querier: () => unknown, deps: unknown[] = []) => {
      const [value, setValue] = useState<unknown>(undefined);
      useEffect(() => {
        let active = true;
        void Promise.resolve(querier()).then((next) => {
          if (active) setValue(next);
        });
        return () => {
          active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
      return value;
    },
  };
});

// 何をするかの決め方(autoSyncModeOnOpen)は本物のまま使い、通信する同期だけ差し替える。
vi.mock("../../lib/gmailSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/gmailSync")>()),
  syncGmailAccount: async (_account: unknown, mode: string = "full") => {
    mocks.syncCalls += 1;
    mocks.syncModes.push(mode);
    return { summary: "", stateError: null, error: null };
  },
  summarizeGmailSync: () => null,
}));

vi.mock("../../lib/blockedSenders", () => ({
  blockSenderRemote: async () => undefined,
  unblockSenderRemote: async () => undefined,
}));

vi.mock("../../lib/gmailMessageState", () => ({
  updateMessageState: async (_account: string, email: { id: unknown }, patch: unknown) => {
    mocks.stateUpdates.push({ id: email.id, patch });
  },
}));

const { GmailInbox } = await import("./GmailInbox");

const account: GmailAccount = {
  id: "acc1",
  email: "me@example.com",
  accessToken: "a",
  accessTokenExpiresAt: Date.now() + 3_600_000,
  refreshToken: "r",
  connectedAt: 0,
};

function email(id: string, subject: string, extra: Partial<SyncedEmail> = {}): Record<string, unknown> {
  return {
    id,
    accountId: "acc1",
    gmailMessageId: `g-${id}`,
    threadId: `t-${id}`,
    from: "採用担当 <hr@example.com>",
    subject,
    snippet: "本文の抜粋",
    receivedAt: Date.parse("2026-08-28T09:00:00+09:00"),
    status: "unprocessed",
    createdAt: 0,
    ...extra,
  };
}

/** 一覧の見え方の控えはアカウントごとなので(GmailInbox.tsx の rememberedView)、
 * テストごとに別のIDを渡して、前のテストの絞り込みを持ち越さないようにする。 */
function renderInbox(overrides: Partial<GmailAccount> = {}, props: Partial<Parameters<typeof GmailInbox>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <GmailInbox account={{ ...account, ...overrides }} {...props} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("メール一覧", () => {
  beforeEach(() => {
    mocks.emails = [email("m1", "一次面接のご案内"), email("m2", "説明会の御礼", { readAt: 1, status: "sent" })];
    mocks.syncCalls = 0;
    mocks.syncModes = [];
    mocks.replyWaiting = [];
  });

  it("返信待ちがあれば絞り込みを出し、何日待っているかを行に出す", async () => {
    const user = userEvent.setup();
    // 一覧はアカウントごとに出すので、返信待ちもそのアカウント(ここでは id "waiting")のもの。
    mocks.replyWaiting = [{ email: { ...mocks.emails[1], accountId: "waiting" }, sentAt: 0, waitingDays: 4 }];
    renderInbox({ id: "waiting" });
    await screen.findByRole("link", { name: /一次面接のご案内/ });

    await user.click(screen.getByRole("button", { name: "返信待ち 1" }));
    expect(await screen.findByRole("link", { name: /説明会の御礼/ })).toBeTruthy();
    expect(screen.getByText("返信待ち 4日")).toBeTruthy();
    // 返信待ちでないメールは、この絞り込みには出ない。
    expect(screen.queryByRole("link", { name: /一次面接のご案内/ })).toBeNull();
  });

  it("返信待ちが1件も無ければ、絞り込みのボタンごと出さない", async () => {
    renderInbox({ id: "no-waiting" });
    await screen.findByRole("link", { name: /一次面接のご案内/ });
    expect(screen.queryByRole("button", { name: /返信待ち/ })).toBeNull();
  });

  it("ほかのアカウントの返信待ちは、この一覧に数えない", async () => {
    mocks.replyWaiting = [{ email: { ...mocks.emails[1], accountId: "other" }, sentAt: 0, waitingDays: 4 }];
    renderInbox({ id: "other-account" });
    await screen.findByRole("link", { name: /一次面接のご案内/ });
    expect(screen.queryByRole("button", { name: /返信待ち/ })).toBeNull();
  });

  afterEach(() => {
    cleanup();
  });

  it("行は同じタブでメール画面へ移る(新規タブを増やさない)", async () => {
    renderInbox({ id: "link" });
    const row = await screen.findByRole("link", { name: /一次面接のご案内/ });
    expect(row.getAttribute("href")).toBe("/gmail/mail/m1");
    // target="_blank" だった頃は、1通読むごとにタブが増えていた。
    expect(row.getAttribute("target")).toBeNull();
  });

  it("メールを開いて戻ってきても、絞り込みと検索語はそのまま", async () => {
    const user = userEvent.setup();
    const first = renderInbox({ id: "keep" });
    await screen.findByRole("link", { name: /一次面接のご案内/ });

    await user.click(screen.getByRole("button", { name: "送信済み" }));
    await user.type(screen.getByPlaceholderText("メールを検索"), "説明会");
    expect(await screen.findByRole("link", { name: /説明会の御礼/ })).toBeTruthy();

    // メール画面へ移ると、この一覧はいったん消える。
    first.unmount();
    renderInbox({ id: "keep" });

    await waitFor(() =>
      expect((screen.getByPlaceholderText("メールを検索") as HTMLInputElement).value).toBe("説明会"),
    );
    expect(screen.getByRole("button", { name: "送信済み" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("直前(1分以内)に全部の同期をしていれば、開き直しでは何もしない", async () => {
    renderInbox({ id: "fresh", lastSyncedAt: Date.now() - 5_000 });
    await screen.findByRole("link", { name: /一次面接のご案内/ });
    expect(mocks.syncCalls).toBe(0);
  });

  it("全部の同期から10分以内なら、開いた時は軽い確認(新着だけ)にする。重い突き合わせはしない", async () => {
    renderInbox({ id: "recent", lastSyncedAt: Date.now() - 5 * 60_000 });
    await waitFor(() => expect(mocks.syncCalls).toBe(1));
    expect(mocks.syncModes).toEqual(["quick"]);
  });

  it("全部の同期から10分以上たっていれば、開いた時に全部の同期をする", async () => {
    renderInbox({ id: "stale", lastSyncedAt: Date.now() - 11 * 60_000 });
    await waitFor(() => expect(mocks.syncCalls).toBe(1));
    expect(mocks.syncModes).toEqual(["full"]);
  });

  it("一度も同期していないアカウントは、開いた時に全部の同期をする", async () => {
    renderInbox({ id: "never" });
    await waitFor(() => expect(mocks.syncCalls).toBe(1));
    expect(mocks.syncModes).toEqual(["full"]);
  });

  it("抜粋の &amp; などは元の字に戻して出し、戻した字で探せる", async () => {
    const user = userEvent.setup();
    // Gmail API の抜粋は文字参照のまま届く(保存も届いたまま)。
    mocks.emails = [email("m1", "【予約確認】Agoda", { snippet: "Agoda.com ホテル &amp; 一軒家 &lt;予約番号&gt;" })];
    renderInbox({ id: "entities" });

    expect(await screen.findByText("Agoda.com ホテル & 一軒家 <予約番号>")).toBeTruthy();
    expect(screen.queryByText(/&amp;/)).toBeNull();

    await user.type(screen.getByPlaceholderText("メールを検索"), "ホテル & 一軒家");
    expect(await screen.findByRole("link", { name: /Agoda/ })).toBeTruthy();
  });

  it("絞り込みのチップは1段のまま横に流す(折り返さない)", async () => {
    renderInbox({ id: "chips" });
    await screen.findByRole("link", { name: /一次面接のご案内/ });
    const group = screen.getByRole("group", { name: "ステータスフィルター" });
    expect(group.className).toContain("overflow-x-auto");
    expect(group.className).not.toContain("flex-wrap");
  });

  describe("左へ払うと既読(UI/UX 調査メモ 第4弾 A-3)", () => {
    /** jsdom には PointerEvent が無い(src/components/ui/SwipeRow.test.tsx と同じ)。 */
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? "touch";
        this.isPrimary = init.isPrimary ?? true;
      }
    }

    beforeEach(() => {
      vi.stubGlobal("PointerEvent", TestPointerEvent);
      mocks.stateUpdates = [];
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
        () => ({ top: 0, bottom: 80, left: 0, right: 360, width: 360, height: 80, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    function swipeLeft(target: HTMLElement) {
      fireEvent.pointerDown(target, { pointerId: 1, pointerType: "touch", clientX: 330, clientY: 40 });
      fireEvent.pointerMove(target, { pointerId: 1, pointerType: "touch", clientX: 260, clientY: 40 });
      fireEvent.pointerMove(target, { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 40 });
      fireEvent.pointerUp(target, { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 40 });
    }

    it("「既読にする」と同じく既読にする(払っただけでメールは開かない)", async () => {
      renderInbox({ id: "swipe" });
      const row = await screen.findByRole("link", { name: /一次面接のご案内/ });
      let opened = false;
      row.addEventListener("click", (event) => {
        if (!event.defaultPrevented) opened = true;
      });
      swipeLeft(row);
      fireEvent.click(row);
      await waitFor(() => expect(mocks.stateUpdates).toHaveLength(1));
      expect(mocks.stateUpdates[0].id).toBe("m1");
      expect(mocks.stateUpdates[0].patch).toHaveProperty("readAt");
      expect(opened).toBe(false);
    });

    it("もう既読のメールは払えない(「既読にする」のボタンが無い行)", async () => {
      mocks.emails = [email("m1", "見返したいメール", { importantAt: 1, readAt: 1 })];
      renderInbox({ id: "swipe-read" });
      await userEvent.click(await screen.findByRole("button", { name: "重要" }));
      const row = await screen.findByRole("link", { name: /見返したいメール/ });
      expect(row.closest(".swipe-row")?.className).not.toContain("swipe-row--enabled");
      swipeLeft(row);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(mocks.stateUpdates).toHaveLength(0);
    });
  });

  describe("PC(compact)", () => {
    it("1通1行で、行き先は渡された所(同じ画面の右に開く)、開いている行に印を付ける", async () => {
      renderInbox(
        { id: "compact" },
        {
          compact: true,
          selectedMailId: "m2",
          mailLink: (id) => ({ to: `/gmail?mail=${id}`, replace: true }),
        },
      );
      // 「すべて」には m1 だけ(m2 は送信済み)。送信済みへ切り替えて m2 も見る。
      const first = await screen.findByRole("link", { name: /一次面接のご案内/ });
      expect(first.getAttribute("href")).toBe("/gmail?mail=m1");
      expect(first.getAttribute("aria-current")).toBeNull();
      // 差出人・件名・抜粋が1つの行(リンク)に入っている。
      expect(first.textContent).toContain("採用担当");
      expect(first.textContent).toContain("本文の抜粋");

      await userEvent.click(screen.getByRole("button", { name: "送信済み" }));
      const opened = await screen.findByRole("link", { name: /説明会の御礼/ });
      expect(opened.getAttribute("aria-current")).toBe("true");
    });

    it("重要の印を行に出す", async () => {
      mocks.emails = [email("m1", "見返したいメール", { importantAt: 1, readAt: 1 })];
      renderInbox({ id: "compact-important" }, { compact: true });
      await userEvent.click(await screen.findByRole("button", { name: "重要" }));
      const row = await screen.findByRole("link", { name: /見返したいメール/ });
      expect(row.querySelector('[title="重要"]')).not.toBeNull();
    });
  });
});

describe("メール一覧の件数の区切り(iPhone で一覧ごと消える不具合の対策)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.emails = Array.from({ length: 120 }, (_, i) => email(`p${i}`, `件名-${i}`));
    mocks.syncCalls = 0;
    mocks.replyWaiting = [];
  });

  it("先頭の50通だけ並べ、「さらに表示」で足していく", async () => {
    const user = userEvent.setup();
    renderInbox({ id: "paging" });
    await screen.findByRole("link", { name: /件名-0\b/ });
    // 開いた最初の描画は先頭の数行だけ。動きが終わるころに、50通まで足される。
    await waitFor(() => expect(screen.getAllByRole("link", { name: /件名-/ })).toHaveLength(50), { timeout: 5000 });

    await user.click(screen.getByRole("button", { name: "さらに表示（残り70件）" }));
    expect(screen.getAllByRole("link", { name: /件名-/ })).toHaveLength(100);
    await user.click(screen.getByRole("button", { name: "さらに表示（残り20件）" }));
    expect(screen.getAllByRole("link", { name: /件名-/ })).toHaveLength(120);
    expect(screen.queryByRole("button", { name: /さらに表示/ })).toBeNull();
  });

  it("検索は区切りの外の通も相手にし、検索語を変えたら先頭から並べ直す", async () => {
    const user = userEvent.setup();
    renderInbox({ id: "paging-search" });
    await screen.findByRole("link", { name: /件名-0\b/ });
    await user.click(await screen.findByRole("button", { name: "さらに表示（残り70件）" }, { timeout: 5000 }));
    expect(screen.getAllByRole("link", { name: /件名-/ })).toHaveLength(100);

    // 件名-119 は先頭50通にも100通にも入らないが、検索には当たる。
    await user.type(screen.getByPlaceholderText("メールを検索"), "件名-119");
    expect(await screen.findByRole("link", { name: /件名-119/ })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /件名-/ })).toHaveLength(1);

    // 検索語を消すと、前に増やした100通のままではなく、先頭の50通に戻る。
    await user.clear(screen.getByPlaceholderText("メールを検索"));
    await waitFor(() => expect(screen.getAllByRole("link", { name: /件名-/ })).toHaveLength(50));
  });

  it("50通以内なら「さらに表示」は出さない", async () => {
    mocks.emails = Array.from({ length: 50 }, (_, i) => email(`q${i}`, `件名-${i}`));
    renderInbox({ id: "paging-small" });
    await screen.findByRole("link", { name: /件名-0\b/ });
    expect(screen.queryByRole("button", { name: /さらに表示/ })).toBeNull();
  });
});

describe("メール一覧 — 開き直した時に空白・誤表示を出さない", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.emails = [email("r1", "一次面接のご案内"), email("r2", "説明会の御礼")];
    mocks.syncCalls = 0;
    mocks.replyWaiting = [];
  });

  it("開き直した最初の描画から、前に読んだ一覧が出る(読み出しを待たない)", async () => {
    const first = renderInbox({ id: "reopen" });
    await screen.findByRole("link", { name: /一次面接のご案内/ });
    first.unmount();

    renderInbox({ id: "reopen" });
    // 端末からの読み出しはまだ終わっていない(次のタスクで解決する)のに、もう並んでいる。
    expect(screen.getAllByRole("link", { name: /一次面接のご案内|説明会の御礼/ })).toHaveLength(2);
  });

  it("絞り込みの先頭は「未処理」。片付いていて空なら「未処理のメールはありません」、検索で空なら「該当する結果」(第8弾 G-1)", async () => {
    mocks.emails = [email("m1", "読んだメール", { readAt: 5 })];
    renderInbox({ id: "empty-label" });
    expect(await screen.findByRole("button", { name: "未処理" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "すべて" })).toBeNull();
    expect(await screen.findByText("未処理のメールはありません")).toBeTruthy();
    expect(screen.queryByText("該当する結果が見つかりませんでした")).toBeNull();
    // 既読の絞り込みにすれば、読んだメールが出る。
    await userEvent.click(screen.getByRole("button", { name: "既読" }));
    expect(await screen.findByText("読んだメール")).toBeTruthy();
    // 検索語で空になった時だけ「該当する結果」。
    await userEvent.type(screen.getByPlaceholderText("メールを検索"), "ない語");
    expect(await screen.findByText("該当する結果が見つかりませんでした")).toBeTruthy();
  });

  it("読み出し中に「受信メールはまだありません」を一瞬出さない(初めて開く時も)", async () => {
    renderInbox({ id: "first-open" });
    expect(screen.queryByText("受信メールはまだありません")).toBeNull();
    await screen.findByRole("link", { name: /一次面接のご案内/ });
  });
});

describe("メール一覧 — 出現の動き(ほかの画面と同じ)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.emails = Array.from({ length: 20 }, (_, i) => email(`a${i}`, `件名-${i}`));
    mocks.syncCalls = 0;
    mocks.replyWaiting = [];
  });

  it("検索・絞り込み・先頭の8行だけが出現の動きの対象で、それより後ろははじめから出す", async () => {
    const { container } = renderInbox({ id: "reveal" });
    await screen.findByRole("link", { name: /件名-0\b/ });
    await waitFor(() => expect(container.querySelectorAll("[data-mail-id]")).toHaveLength(20), { timeout: 5000 });
    expect(container.querySelectorAll("[data-page-block]").length).toBeGreaterThanOrEqual(2); // 検索と絞り込み
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-mail-id]"));
    expect(rows.slice(0, 8).every((row) => !row.hasAttribute("data-no-reveal"))).toBe(true);
    expect(rows.slice(8).every((row) => row.hasAttribute("data-no-reveal"))).toBe(true);
  });
});

/** 「最初の12行」から「残りを足す」への切り替えのタイマー(0.35秒)を、手で止めておく。実際の時間に頼ると、Mac が混み合った時に
 * 確かめる前に時間が過ぎてしまい、落ちた(2026-10-13)。返り値の settle() を呼ぶと、残りが足される。 */
function holdSettleTimer() {
  const realSetTimeout = window.setTimeout.bind(window);
  let held: (() => void) | null = null;
  vi.spyOn(window, "setTimeout").mockImplementation(((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (ms === 350 && typeof handler === "function") {
      held = handler as () => void;
      return 0 as unknown as number;
    }
    return realSetTimeout(handler, ms, ...args);
  }) as typeof window.setTimeout);
  return {
    settle: () =>
      act(() => {
        held?.();
      }),
  };
}

describe("メール一覧 — 開いた最初の描画は先頭の数行だけ", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    mocks.emails = Array.from({ length: 40 }, (_, i) => email(`f${i}`, `件名-${i}`));
    mocks.syncCalls = 0;
    mocks.replyWaiting = [];
  });

  it("最初は12行だけ並べ、そのあと残りが足される(50通までなら全部)", async () => {
    const timer = holdSettleTimer();
    renderInbox({ id: "first-paint" });
    await screen.findByRole("link", { name: /件名-0\b/ });
    expect(screen.getAllByRole("link", { name: /件名-/ })).toHaveLength(12);
    timer.settle();
    await waitFor(() => expect(screen.getAllByRole("link", { name: /件名-/ })).toHaveLength(40));
    expect(screen.queryByRole("button", { name: /さらに表示/ })).toBeNull();
  });

  it("最初の12行のあいだは「さらに表示」を出さない(まだ全部並べていないため)", async () => {
    mocks.emails = Array.from({ length: 120 }, (_, i) => email(`g${i}`, `件名-${i}`));
    const timer = holdSettleTimer();
    renderInbox({ id: "first-paint-more" });
    await screen.findByRole("link", { name: /件名-0\b/ });
    expect(screen.queryByRole("button", { name: /さらに表示/ })).toBeNull();
    timer.settle();
    expect(await screen.findByRole("button", { name: "さらに表示（残り70件）" })).toBeTruthy();
  });
});
