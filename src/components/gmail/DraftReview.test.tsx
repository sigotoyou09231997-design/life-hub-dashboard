/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmailAccount, SyncedEmail } from "../../types";
import { ToastProvider } from "../ui/ToastProvider";
import { ConfirmProvider } from "../ui/ConfirmProvider";

const mocks = vi.hoisted(() => ({
  content: { text: "", html: "", preferHtml: false, inlineImages: {} as Record<string, string> },
  fetchedIds: [] as string[],
}));

vi.mock("../../db/schema", () => ({
  db: {
    draftReplies: { where: () => ({ equals: () => ({ first: async () => undefined }) }) },
    blockedSenders: { where: () => ({ equals: () => ({ first: async () => undefined }) }) },
    jobApplications: { toArray: async () => [] },
    calendarEvents: { toArray: async () => [] },
    syncedEmails: { update: async () => 1 },
  },
}));

// useLiveQuery は本物のDexieテーブルを相手にしないと値を返さない。ここで見たいのは
// 画面の組み立てなので、問い合わせ関数を1回実行するだけの最小版に差し替える
// (src/components/gmail/GmailInbox.test.tsx と同じ)。
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

// Gmail へ取りに行く所だけ差し替える。差出人の読み取りなどは本物のまま使う。
vi.mock("../../lib/gmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/gmail")>()),
  ensureFreshAccessToken: async (account: GmailAccount) => account,
  getMessageContent: async (_token: string, id: string) => {
    mocks.fetchedIds.push(id);
    return mocks.content;
  },
}));

vi.mock("./MailPlanImport", () => ({ MailPlanImport: () => null }));
vi.mock("./MailExpenseImport", () => ({ MailExpenseImport: () => null }));
vi.mock("../../lib/blockedSenders", () => ({
  blockSenderRemote: async () => undefined,
  unblockSenderRemote: async () => undefined,
}));
vi.mock("../../lib/gmailMessageState", () => ({ updateMessageState: async () => undefined }));

const { DraftReview } = await import("./DraftReview");
const { MAIL_FRAME_SANDBOX } = await import("./MailBody");

const account: GmailAccount = {
  id: "acc1",
  email: "me@example.com",
  accessToken: "a",
  accessTokenExpiresAt: Date.now() + 3_600_000,
  refreshToken: "r",
  connectedAt: 0,
};

function email(extra: Partial<SyncedEmail> = {}): SyncedEmail {
  return {
    id: "m1",
    accountId: "acc1",
    gmailMessageId: "g-m1",
    threadId: "t-m1",
    from: "採用担当 <hr@example.com>",
    subject: "一次面接のご案内",
    snippet: "本文の抜粋",
    receivedAt: Date.parse("2026-10-10T09:00:00+09:00"),
    status: "unprocessed",
    createdAt: 0,
    ...extra,
  };
}

function renderMail(target: SyncedEmail, props: { stacked?: boolean } = {}) {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <DraftReview email={target} account={account} {...props} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

/** 「予定を追加しますか?」が出る日時(過ぎた日付の案内には出ないので、いつ走らせても先の日にする)。 */
function upcomingDateText(): string {
  const d = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  return `${d.getMonth() + 1}月${d.getDate()}日 14:00`;
}

function frame(): HTMLIFrameElement | null {
  return document.querySelector("iframe");
}

describe("メール1通の画面", () => {
  beforeEach(() => {
    mocks.content = { text: "", html: "", preferHtml: false, inlineImages: {} };
    mocks.fetchedIds = [];
  });

  afterEach(() => cleanup());

  it("本文を返信欄より先に出す(人からのメールは返信欄も開いたまま)", async () => {
    mocks.content = { text: "9月3日 10:00 から一次面接です。", html: "", preferHtml: false, inlineImages: {} };
    renderMail(email());

    const body = await screen.findByText("9月3日 10:00 から一次面接です。");
    const generate = await screen.findByRole("button", { name: "AI下書きを作成" });
    // 画面の並び(DOMの順)で、本文が返信欄より前にあること。
    expect(body.compareDocumentPosition(generate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "返信案を作る" })).toBeNull();
    // 平文しか無いメールには、見た目の切り替えを出さない。
    expect(screen.queryByRole("button", { name: "元の見た目で見る" })).toBeNull();
  });

  it("送信専用アドレスのメールは、返信欄を閉じておき「返信案を作る」で開く", async () => {
    mocks.content = { text: "ご注文ありがとうございました。", html: "", preferHtml: false, inlineImages: {} };
    renderMail(email({ from: "ショップ <no-reply@shop.example.jp>", subject: "ご注文の確認" }));

    await screen.findByText("ご注文ありがとうございました。");
    expect(screen.queryByRole("button", { name: "AI下書きを作成" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "返信案を作る" }));
    expect(await screen.findByRole("button", { name: "AI下書きを作成" })).toBeTruthy();

    // 開いた後も「閉じる」で畳める。
    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("button", { name: "AI下書きを作成" })).toBeNull();
  });

  it("本人が手を付けた送信専用アドレスのメールは、返信欄を開いたまま出す", async () => {
    mocks.content = { text: "お知らせ", html: "", preferHtml: false, inlineImages: {} };
    renderMail(email({ from: "noreply@example.com", status: "edited" }));
    expect(await screen.findByRole("button", { name: "AI下書きを作成" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "返信案を作る" })).toBeNull();
  });

  it("HTMLしか無いメールは、スクリプトの動かない枠で元の見た目のまま出し、外の画像は押すまで止める", async () => {
    mocks.content = {
      text: "秋のセール",
      html: '<p>秋のセール</p><img src="https://cdn.example.com/hero.png"><script>alert(1)</script>',
      preferHtml: true,
      inlineImages: {},
    };
    renderMail(email({ from: "newsletter@shop.example.jp", subject: "秋のセール" }));

    await waitFor(() => expect(frame()).not.toBeNull());
    const iframe = frame()!;
    expect(iframe.getAttribute("sandbox")).toBe(MAIL_FRAME_SANDBOX);
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-scripts");
    const srcdoc = iframe.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("img-src data:;");
    expect(srcdoc).not.toContain("cdn.example.com");
    expect(srcdoc).not.toContain("<script");
    expect(screen.getByText(/画像は止めています/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "画像を表示する" }));
    const allowed = frame()!.getAttribute("srcdoc") ?? "";
    expect(allowed).toContain("img-src data: https:;");
    expect(allowed).toContain("https://cdn.example.com/hero.png");
    expect(screen.queryByRole("button", { name: "画像を表示する" })).toBeNull();

    // 文字だけでも読める。
    await userEvent.click(screen.getByRole("button", { name: "文字だけで見る" }));
    expect(frame()).toBeNull();
    expect(screen.getByText("秋のセール", { selector: "div" })).toBeTruthy();
  });

  it("平文とHTMLの両方があるメールは文章で出し、「元の見た目で見る」でHTMLに切り替えられる", async () => {
    mocks.content = { text: "平文の本文", html: "<p>HTMLの本文</p>", preferHtml: false, inlineImages: {} };
    renderMail(email());

    await screen.findByText("平文の本文");
    expect(frame()).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "元の見た目で見る" }));
    await waitFor(() => expect(frame()).not.toBeNull());
    expect(frame()!.getAttribute("srcdoc")).toContain("HTMLの本文");
    // 外の画像が無いメールには「画像を表示する」を出さない。
    expect(screen.queryByRole("button", { name: "画像を表示する" })).toBeNull();
  });

  it("「予定を追加しますか?」が出るメールでは、上の「予定に追加する」ボタンを重ねて出さない", async () => {
    mocks.content = { text: "面接のご案内です。", html: "", preferHtml: false, inlineImages: {} };
    renderMail(email({ snippet: `${upcomingDateText()} より一次面接を行います`, receivedAt: Date.now() }));

    expect(await screen.findByRole("button", { name: "予定を追加" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "予定に追加する" })).toBeNull();
  });

  it("提案の出ないメールでは、上の「予定に追加する」ボタンから予定を作れる", async () => {
    mocks.content = { text: "いつもありがとうございます。", html: "", preferHtml: false, inlineImages: {} };
    renderMail(email({ subject: "近況のご報告", snippet: "いつもありがとうございます。" }));

    expect(await screen.findByRole("button", { name: "予定に追加する" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "予定を追加" })).toBeNull();
  });

  it("本文が取れない時に出す抜粋は、&amp; などを元の字に戻して出す", async () => {
    // getMessageContent が文章を返さない(画像だけのメールなど)と、保存してある抜粋を出す。
    renderMail(email({ snippet: "ホテル &amp; 一軒家 &lt;予約番号 123&gt;" }));
    expect(await screen.findByText("ホテル & 一軒家 <予約番号 123>")).toBeTruthy();
  });

  it("stacked(PCの一覧の右側)では、本文と返信を左右に並べず縦1列にする", async () => {
    mocks.content = { text: "本文です", html: "", preferHtml: false, inlineImages: {} };
    const layout = (container: HTMLElement) => container.querySelector<HTMLElement>(".grid.grid-cols-1")?.className ?? "";

    const page = renderMail(email());
    await screen.findByText("本文です");
    expect(layout(page.container)).toContain("lg:grid-cols-");
    page.unmount();

    const pane = renderMail(email(), { stacked: true });
    await screen.findByText("本文です");
    expect(layout(pane.container)).not.toBe("");
    expect(layout(pane.container)).not.toContain("lg:grid-cols-");
  });
});
