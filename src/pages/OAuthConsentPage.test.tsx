/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  details: vi.fn(),
  approve: vi.fn(),
  deny: vi.fn(),
  went: [] as string[],
}));

vi.mock("../lib/supabase", () => ({
  auth: {
    oauth: {
      getAuthorizationDetails: mocks.details,
      approveAuthorization: mocks.approve,
      denyAuthorization: mocks.deny,
    },
  },
}));

// 別のサイトへ移る所だけ差し替える(移った先を見るため)。
vi.mock("../lib/oauthConsent", async () => {
  const actual = await vi.importActual<typeof import("../lib/oauthConsent")>("../lib/oauthConsent");
  return { ...actual, goTo: (url: string) => void mocks.went.push(url) };
});

import OAuthConsentPage from "./OAuthConsentPage";

const details = (overrides: Record<string, unknown> = {}) => ({
  authorization_id: "abcd1234-ef56",
  redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
  client: { id: "c1", name: "ChatGPT", uri: "https://chatgpt.com", logo_uri: "" },
  user: { id: "u1", email: "me@example.com" },
  scope: "openid email",
  ...overrides,
});

beforeEach(() => {
  mocks.details.mockReset();
  mocks.approve.mockReset();
  mocks.deny.mockReset();
  mocks.went.length = 0;
  window.sessionStorage.clear();
  window.history.pushState({}, "", "/oauth/consent?authorization_id=abcd1234-ef56");
});

afterEach(cleanup);

describe("接続の同意画面", () => {
  it("誰が・どのアカウントで・どこへ戻すかと、できること、できないことを出す", async () => {
    mocks.details.mockResolvedValue({ data: details(), error: null });
    render(<OAuthConsentPage />);
    expect(await screen.findByText(/「ChatGPT」が LIFE HUB への接続を求めています/)).toBeTruthy();
    expect(screen.getByText("me@example.com")).toBeTruthy();
    expect(screen.getByText("chatgpt.com")).toBeTruthy();
    expect(screen.getByText(/旅行に日程を足す/)).toBeTruthy();
    expect(screen.getByText(/消したり書き換えたりはしません/)).toBeTruthy();
    expect(screen.getByText(/旅行以外のデータは対象外/)).toBeTruthy();
    expect(screen.getByText(/「接続しているアプリ」から、いつでも外せます/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "許可する" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("「許可する」で、ChatGPT の戻り先へ移る", async () => {
    mocks.details.mockResolvedValue({ data: details(), error: null });
    mocks.approve.mockResolvedValue({ data: { redirect_url: "https://chatgpt.com/cb?code=abc&state=s" }, error: null });
    render(<OAuthConsentPage />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "許可する" }));
    await waitFor(() => expect(mocks.went).toEqual(["https://chatgpt.com/cb?code=abc&state=s"]));
    expect(mocks.approve).toHaveBeenCalledWith("abcd1234-ef56", { skipBrowserRedirect: true });
  });

  it("「許可しない」で、断って戻る(許可は呼ばない)", async () => {
    mocks.details.mockResolvedValue({ data: details(), error: null });
    mocks.deny.mockResolvedValue({ data: { redirect_url: "https://chatgpt.com/cb?error=access_denied" }, error: null });
    render(<OAuthConsentPage />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "許可しない" }));
    await waitFor(() => expect(mocks.went).toEqual(["https://chatgpt.com/cb?error=access_denied"]));
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("名前だけ ChatGPT を装った別の先は、警告を出し、許可できない。断ることはできる", async () => {
    mocks.details.mockResolvedValue({ data: details({ redirect_uri: "https://chatgpt.com.evil.example/cb" }), error: null });
    mocks.deny.mockResolvedValue({ data: { redirect_url: "https://chatgpt.com.evil.example/cb?error=access_denied" }, error: null });
    render(<OAuthConsentPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/ChatGPT\(chatgpt.com・openai.com\)ではありません/)).toBeTruthy();
    expect(screen.getByText("chatgpt.com.evil.example")).toBeTruthy();
    expect((screen.getByRole("button", { name: "許可する" }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.setup().click(screen.getByRole("button", { name: "許可しない" }));
    expect(await screen.findByText(/接続を断りました/)).toBeTruthy();
    // 知らない先へは、断る結果であっても移らない。
    expect(mocks.went).toEqual([]);
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("すでに許可済みの接続は、確認を挟まずに戻す", async () => {
    mocks.details.mockResolvedValue({ data: { redirect_url: "https://chatgpt.com/cb?code=xyz" }, error: null });
    render(<OAuthConsentPage />);
    await waitFor(() => expect(mocks.went).toEqual(["https://chatgpt.com/cb?code=xyz"]));
    expect(screen.queryByRole("button", { name: "許可する" })).toBeNull();
  });

  it("依頼の印が無い・期限切れ・完了できなかった時は、案内を出す", async () => {
    window.history.pushState({}, "", "/oauth/consent");
    render(<OAuthConsentPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("接続の依頼が見つかりません");
    expect(mocks.details).not.toHaveBeenCalled();
    cleanup();

    window.history.pushState({}, "", "/oauth/consent?authorization_id=abcd1234-ef56");
    mocks.details.mockResolvedValue({ data: null, error: { message: "expired" } });
    render(<OAuthConsentPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("期限が切れたか");
    cleanup();

    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.details.mockResolvedValue({ data: details(), error: null });
    mocks.approve.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<OAuthConsentPage />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "許可する" }));
    expect((await screen.findByRole("alert")).textContent).toContain("接続を完了できませんでした");
    expect(mocks.went).toEqual([]);
  });

  it("ログインの往復のために預けた印は、この画面に戻れたら捨てる", async () => {
    window.sessionStorage.setItem("lifehub.pendingOAuthConsent", JSON.stringify({ id: "abcd1234-ef56", at: Date.now() }));
    mocks.details.mockResolvedValue({ data: details(), error: null });
    render(<OAuthConsentPage />);
    await screen.findByRole("button", { name: "許可する" });
    expect(window.sessionStorage.getItem("lifehub.pendingOAuthConsent")).toBeNull();
  });
});
