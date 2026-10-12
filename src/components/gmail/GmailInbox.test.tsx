/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { GmailAccount, SyncedEmail } from "../../types";
import { ToastProvider } from "../ui/ToastProvider";

const mocks = vi.hoisted(() => ({
  emails: [] as Record<string, unknown>[],
  syncCalls: 0,
  /** 返信待ちの判定そのものは src/lib/replyWaiting.test.ts で見る。ここでは結果だけ渡す。 */
  replyWaiting: [] as { email: Record<string, unknown>; sentAt: number; waitingDays: number }[],
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

vi.mock("../../lib/gmailSync", () => ({
  syncGmailAccount: async () => {
    mocks.syncCalls += 1;
    return { summary: "", stateError: null, error: null };
  },
  summarizeGmailSync: () => null,
}));

vi.mock("../../lib/blockedSenders", () => ({
  blockSenderRemote: async () => undefined,
  unblockSenderRemote: async () => undefined,
}));

vi.mock("../../lib/gmailMessageState", () => ({
  updateMessageState: async () => undefined,
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

  it("直前に同期していれば、開き直しで取りに行かない", async () => {
    renderInbox({ id: "fresh", lastSyncedAt: Date.now() - 5_000 });
    await screen.findByRole("link", { name: /一次面接のご案内/ });
    expect(mocks.syncCalls).toBe(0);
  });

  it("しばらく同期していなければ、開いた時に取りに行く", async () => {
    renderInbox({ id: "stale", lastSyncedAt: Date.now() - 10 * 60_000 });
    await waitFor(() => expect(mocks.syncCalls).toBe(1));
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
