/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  details: vi.fn(),
  approve: vi.fn(),
  deny: vi.fn(),
}));

vi.mock("./supabase", () => ({
  auth: {
    oauth: {
      getAuthorizationDetails: mocks.details,
      approveAuthorization: mocks.approve,
      denyAuthorization: mocks.deny,
    },
  },
}));

import {
  decideConsent,
  isOAuthConsentPath,
  isTrustedRedirect,
  loadConsent,
  readAuthorizationId,
  redirectHost,
  rememberPendingConsent,
  takePendingConsent,
} from "./oauthConsent";

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.details.mockReset();
  mocks.approve.mockReset();
  mocks.deny.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("同意画面のURL", () => {
  it("/oauth/consent を見分ける。Supabase の設定で / が重なって来る形(//oauth/consent)も", () => {
    expect(isOAuthConsentPath("/oauth/consent")).toBe(true);
    expect(isOAuthConsentPath("//oauth/consent")).toBe(true);
    expect(isOAuthConsentPath("/oauth/consent/")).toBe(true);
    expect(isOAuthConsentPath("/oauth/consent/evil")).toBe(false);
    expect(isOAuthConsentPath("/oauth")).toBe(false);
    expect(isOAuthConsentPath("/trips")).toBe(false);
  });

  it("authorization_id を取り出す。形の違うものは受け付けない", () => {
    expect(readAuthorizationId("?authorization_id=abcd1234-ef56")).toBe("abcd1234-ef56");
    expect(readAuthorizationId("?authorization_id=short")).toBeNull();
    expect(readAuthorizationId("?authorization_id=has space and <tags>")).toBeNull();
    expect(readAuthorizationId("")).toBeNull();
  });
});

describe("接続の戻り先が ChatGPT か", () => {
  it("chatgpt.com と openai.com(サブドメイン含む)だけを通す", () => {
    for (const ok of [
      "https://chatgpt.com/connector_platform_oauth_redirect",
      "https://chatgpt.com/connector/oauth/abc123",
      "https://platform.openai.com/apps-manage/oauth",
      "https://openai.com/x",
    ]) {
      expect(isTrustedRedirect(ok), ok).toBe(true);
    }
  });

  it("似せた名前・別の先・https でないものは通さない", () => {
    for (const bad of [
      "https://chatgpt.com.evil.example/cb",
      "https://evilchatgpt.com/cb",
      "https://notopenai.com/cb",
      "https://chatgpt.com@evil.example/cb",
      "http://chatgpt.com/cb",
      "javascript:alert(1)",
      "https://localhost:3000/cb",
      "https://example.com/?next=https://chatgpt.com/",
      "not a url",
      "",
    ]) {
      expect(isTrustedRedirect(bad), bad).toBe(false);
    }
  });

  it("ドメインを取り出す", () => {
    expect(redirectHost("https://chatgpt.com/connector/oauth/x")).toBe("chatgpt.com");
    expect(redirectHost("???")).toBeNull();
  });
});

describe("ログインの往復の前に、依頼を預かる", () => {
  it("預かったら、1回だけ取り出せる。戻る先は /oauth/consent?authorization_id=…", () => {
    rememberPendingConsent("?authorization_id=abcd1234-ef56");
    expect(takePendingConsent()).toBe("/oauth/consent?authorization_id=abcd1234-ef56");
    expect(takePendingConsent()).toBeNull();
  });

  it("15分を過ぎたものは使わない。形の違う依頼は、そもそも預からない", () => {
    rememberPendingConsent("?authorization_id=abcd1234-ef56", 1_000);
    expect(takePendingConsent(1_000 + 16 * 60 * 1000)).toBeNull();
    rememberPendingConsent("?authorization_id=<script>");
    expect(takePendingConsent()).toBeNull();
    rememberPendingConsent("");
    expect(takePendingConsent()).toBeNull();
  });

  it("壊れた預かりでも落ちない", () => {
    window.sessionStorage.setItem("lifehub.pendingOAuthConsent", "{broken");
    expect(takePendingConsent()).toBeNull();
    window.sessionStorage.setItem("lifehub.pendingOAuthConsent", JSON.stringify({ id: "../../etc", at: Date.now() }));
    expect(takePendingConsent()).toBeNull();
  });
});

describe("loadConsent", () => {
  const details = {
    authorization_id: "abcd1234-ef56",
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    client: { id: "c1", name: "ChatGPT", uri: "https://chatgpt.com", logo_uri: "" },
    user: { id: "u1", email: "me@example.com" },
    scope: "openid email",
  };

  it("許可の確認に必要な中身を返す(戻り先が ChatGPT なら trusted)", async () => {
    mocks.details.mockResolvedValue({ data: details, error: null });
    expect(await loadConsent("abcd1234-ef56")).toEqual({
      kind: "consent",
      details: { authorizationId: "abcd1234-ef56", clientName: "ChatGPT", redirectUri: details.redirect_uri, email: "me@example.com", trusted: true },
    });
  });

  it("名前だけ ChatGPT を装った別の先は、trusted にならない", async () => {
    mocks.details.mockResolvedValue({ data: { ...details, redirect_uri: "https://chatgpt.com.evil.example/cb" }, error: null });
    const result = await loadConsent("abcd1234-ef56");
    expect(result).toMatchObject({ kind: "consent", details: { clientName: "ChatGPT", trusted: false } });
  });

  it("すでに許可済みなら、その戻り先へ(ChatGPT の時だけ)", async () => {
    mocks.details.mockResolvedValue({ data: { redirect_url: "https://chatgpt.com/cb?code=x" }, error: null });
    expect(await loadConsent("abcd1234-ef56")).toEqual({ kind: "redirect", url: "https://chatgpt.com/cb?code=x" });
    mocks.details.mockResolvedValue({ data: { redirect_url: "https://evil.example/cb?code=x" }, error: null });
    expect(await loadConsent("abcd1234-ef56")).toMatchObject({ kind: "error" });
  });

  it("期限切れ・読めない時は、案内つきのエラー(落ちない)", async () => {
    mocks.details.mockResolvedValue({ data: null, error: { message: "expired" } });
    expect(await loadConsent("abcd1234-ef56")).toMatchObject({ kind: "error", message: expect.stringContaining("やり直してください") });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.details.mockRejectedValue(new Error("network"));
    expect(await loadConsent("abcd1234-ef56")).toMatchObject({ kind: "error" });
  });
});

describe("decideConsent", () => {
  it("許可: 戻り先(ChatGPT)を返す。skipBrowserRedirect で、こちらが移る", async () => {
    mocks.approve.mockResolvedValue({ data: { redirect_url: "https://chatgpt.com/cb?code=abc" }, error: null });
    expect(await decideConsent("abcd1234-ef56", true)).toEqual({ redirectUrl: "https://chatgpt.com/cb?code=abc", trusted: true });
    expect(mocks.approve).toHaveBeenCalledWith("abcd1234-ef56", { skipBrowserRedirect: true });
    expect(mocks.deny).not.toHaveBeenCalled();
  });

  it("許可の結果は、ChatGPT 以外には渡さない", async () => {
    mocks.approve.mockResolvedValue({ data: { redirect_url: "https://evil.example/cb?code=abc" }, error: null });
    await expect(decideConsent("abcd1234-ef56", true)).rejects.toThrow("untrusted redirect");
  });

  it("拒否: 戻り先が ChatGPT 以外でも、断ったことは伝わる(移るかどうかは呼び出し側)", async () => {
    mocks.deny.mockResolvedValue({ data: { redirect_url: "https://evil.example/cb?error=access_denied" }, error: null });
    expect(await decideConsent("abcd1234-ef56", false)).toEqual({ redirectUrl: "https://evil.example/cb?error=access_denied", trusted: false });
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("Supabase の失敗は、そのまま失敗として返す", async () => {
    mocks.approve.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(decideConsent("abcd1234-ef56", true)).rejects.toThrow("boom");
  });
});
