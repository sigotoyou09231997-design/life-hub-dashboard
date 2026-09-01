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
function renderInbox(overrides: Partial<GmailAccount> = {}) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <GmailInbox account={{ ...account, ...overrides }} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("メール一覧", () => {
  beforeEach(() => {
    mocks.emails = [email("m1", "一次面接のご案内"), email("m2", "説明会の御礼", { readAt: 1, status: "sent" })];
    mocks.syncCalls = 0;
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
});
