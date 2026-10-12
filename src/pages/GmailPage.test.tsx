/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { GmailAccount, SyncedEmail } from "../types";
import { ToastProvider } from "../components/ui/ToastProvider";

/*
 * PC では一覧の右にメールを開き(/gmail?mail=<id>)、スマホでは今までどおりメール1通の画面
 * (/gmail/mail/:id)へ移る — その行き来と、ブラウザの「戻る」がどこへ戻るかを見る。
 * 一覧(GmailInbox)とメールの中身(DraftReview)はそれぞれのテストで見ているので、ここでは
 * 行き先だけを持つ最小の部品に差し替える。
 */

const mocks = vi.hoisted(() => ({
  desktop: true,
  accounts: [] as GmailAccount[],
  emails: [] as SyncedEmail[],
}));

vi.mock("../hooks/useIsDesktop", () => ({ useIsDesktop: () => mocks.desktop }));

vi.mock("../db/schema", () => ({
  db: {
    gmailAccounts: {
      toArray: async () => mocks.accounts,
      get: async (id: string) => mocks.accounts.find((a) => a.id === id),
    },
    settings: {
      toCollection: () => ({ first: async () => ({ id: "s1", autoDraftEnabled: false }) }),
      update: async () => 1,
    },
    syncedEmails: { get: async (id: string) => mocks.emails.find((e) => e.id === id) },
  },
}));

// 問い合わせ関数を1回(依存が変わるたびに)実行するだけの最小版(GmailInbox.test.tsx と同じ)。
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

vi.mock("../components/gmail/GmailInbox", async () => {
  const { Link } = await import("react-router-dom");
  return {
    GmailInbox: ({
      account,
      selectedMailId,
      mailLink,
    }: {
      account: GmailAccount;
      selectedMailId?: string | null;
      mailLink?: (id: string) => { to: string; replace?: boolean; state?: unknown };
    }) => (
      <div>
        <p>一覧: {account.email}</p>
        {mocks.emails
          .filter((e) => e.accountId === account.id)
          .map((e) => {
            const link = mailLink ? mailLink(e.id!) : { to: `/gmail/mail/${e.id}` };
            return (
              <Link
                key={e.id}
                to={link.to}
                replace={link.replace}
                state={link.state}
                aria-current={selectedMailId === e.id ? "true" : undefined}
              >
                {e.subject}
              </Link>
            );
          })}
      </div>
    ),
  };
});

vi.mock("../components/gmail/DraftReview", () => ({
  DraftReview: ({ email, stacked }: { email: SyncedEmail; stacked?: boolean }) => (
    <p>
      開いたメール: {email.subject}
      {stacked ? "(縦1列)" : ""}
    </p>
  ),
}));
vi.mock("../components/gmail/ComposeMail", () => ({ ComposeMail: () => null }));
vi.mock("../lib/gmailSync", () => ({
  syncGmailAccount: async () => ({ summary: "", stateError: null, error: null }),
  summarizeGmailSync: () => null,
}));
vi.mock("../lib/blockedSenders", () => ({ pullBlockedSenders: async () => undefined }));
vi.mock("../lib/gmailMessageState", () => ({ pullMessageStates: async () => undefined }));
vi.mock("../lib/gmailAccounts", () => ({
  consolidateGmailAccounts: async () => 0,
  readSelectedGmailAccountId: () => null,
  rememberSelectedGmailAccountId: () => undefined,
  resolveSelectedGmailAccountId: (accounts: GmailAccount[], selected: string | null) =>
    accounts.some((a) => a.id === selected) ? selected : (accounts[0]?.id ?? null),
}));

const { default: GmailPage } = await import("./GmailPage");
const { default: GmailMailPage } = await import("./GmailMailPage");

function account(id: string, email: string): GmailAccount {
  return { id, email, accessToken: "a", accessTokenExpiresAt: 0, refreshToken: "r", connectedAt: 0, lastSyncedAt: Date.now() };
}

function mail(id: string, accountId: string, subject: string): SyncedEmail {
  return {
    id,
    accountId,
    gmailMessageId: `g-${id}`,
    threadId: `t-${id}`,
    from: "差出人 <from@example.com>",
    subject,
    snippet: "",
    receivedAt: 0,
    status: "unprocessed",
    createdAt: 0,
  };
}

/** いまのURLと、ブラウザの「戻る」の代わり。 */
function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="url">{location.pathname + location.search}</p>
      <button type="button" onClick={() => navigate(-1)}>
        ブラウザの戻る
      </button>
    </>
  );
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={["/before", url]} initialIndex={1}>
      <ToastProvider>
        <Routes>
          <Route path="/gmail" element={<GmailPage />} />
          <Route path="/gmail/mail/:emailId" element={<GmailMailPage />} />
          <Route path="*" element={<p>前の画面</p>} />
        </Routes>
        <Probe />
      </ToastProvider>
    </MemoryRouter>,
  );
}

const url = () => screen.getByTestId("url").textContent;

describe("Gmail の画面(PC は一覧の右に開く)", () => {
  beforeEach(() => {
    mocks.desktop = true;
    mocks.accounts = [account("acc1", "me@example.com"), account("acc2", "work@example.com")];
    mocks.emails = [
      mail("m1", "acc1", "一次面接のご案内"),
      mail("m2", "acc1", "説明会の御礼"),
      mail("m3", "acc2", "仕事のメール"),
    ];
    localStorage.clear();
  });

  afterEach(() => cleanup());

  it("PC: 行を押すと同じ画面の右に開き、別の行に切り替えても「戻る」1回で一覧だけに戻る", async () => {
    const user = userEvent.setup();
    renderAt("/gmail");

    await user.click(await screen.findByRole("link", { name: "一次面接のご案内" }));
    expect(url()).toBe("/gmail?mail=m1");
    expect(await screen.findByText(/開いたメール: 一次面接のご案内/)).toBeTruthy();
    expect(screen.getByText(/縦1列/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "一次面接のご案内" }).getAttribute("aria-current")).toBe("true");

    // 開いたまま別のメールへ。履歴は積まずに置き換える。
    await user.click(screen.getByRole("link", { name: "説明会の御礼" }));
    expect(url()).toBe("/gmail?mail=m2");
    expect(await screen.findByText(/開いたメール: 説明会の御礼/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "ブラウザの戻る" }));
    expect(url()).toBe("/gmail");
    expect(screen.queryByText(/開いたメール/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "ブラウザの戻る" }));
    expect(url()).toBe("/before");
  });

  it("PC: 「閉じる」は一覧から開いた時は「戻る」と同じ(履歴を増やさない)", async () => {
    const user = userEvent.setup();
    renderAt("/gmail");

    await user.click(await screen.findByRole("link", { name: "一次面接のご案内" }));
    await user.click(await screen.findByRole("button", { name: "閉じる" }));
    expect(url()).toBe("/gmail");
    expect(screen.queryByText(/開いたメール/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "ブラウザの戻る" }));
    expect(url()).toBe("/before");
  });

  it("PC: 通知などから /gmail/mail/:id で来たら、一覧の右に開いた形に置き換え、「閉じる」で一覧だけになる", async () => {
    const user = userEvent.setup();
    renderAt("/gmail/mail/m2");

    expect(await screen.findByText(/開いたメール: 説明会の御礼/)).toBeTruthy();
    expect(url()).toBe("/gmail?mail=m2");

    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(url()).toBe("/gmail");
    // 置き換えで閉じたので、「戻る」は開く前の画面へ。
    await user.click(screen.getByRole("button", { name: "ブラウザの戻る" }));
    expect(url()).toBe("/before");
  });

  it("PC: 別のアカウントのメールを開いたら、左の一覧もそのアカウントにする", async () => {
    renderAt("/gmail?mail=m3");
    expect(await screen.findByText(/開いたメール: 仕事のメール/)).toBeTruthy();
    expect(await screen.findByText("一覧: work@example.com")).toBeTruthy();
  });

  it("PC: 見つからないメールは、右側に「見つかりません」を出す", async () => {
    renderAt("/gmail?mail=nope");
    expect(await screen.findByText("メールが見つかりません")).toBeTruthy();
  });

  it("スマホ: 行はメール1通の画面へ移り、/gmail?mail=<id> で来てもその画面へ移す", async () => {
    mocks.desktop = false;
    renderAt("/gmail?mail=m1");
    expect(await screen.findByText(/開いたメール: 一次面接のご案内/)).toBeTruthy();
    expect(url()).toBe("/gmail/mail/m1");
    expect(screen.queryByText(/縦1列/)).toBeNull();
  });

  it("見出しは「Gmail」(サイドバー・機能一覧と同じ呼び名)", async () => {
    renderAt("/gmail");
    expect(await screen.findByRole("heading", { level: 1, name: "Gmail" })).toBeTruthy();
  });
});
