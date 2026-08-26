// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  signOut: vi.fn(async () => ({ error: null })),
  moveStoredSession: vi.fn(),
  clearStoredSession: vi.fn(),
}));

vi.mock("./supabase", () => ({
  auth: { signOut: supabase.signOut },
  authStorageKey: (slot: string | null) => (slot === null ? "sb-test-auth-token" : `sb-test-auth-token-${slot}`),
  moveStoredSession: supabase.moveStoredSession,
  clearStoredSession: supabase.clearStoredSession,
}));

import { listAccounts, setAddingAccount } from "./accounts";
import { finishAddAccount, signOutActiveAccount } from "./accountSwitch";

// window.location.replace はjsdomでは実行されない(未実装)。切り替え後に必ず読み込み
// 直す設計なので、ここでは呼ばれたことだけ確かめられればよい。
const replace = vi.fn();

function session(userId: string, email: string, name?: string) {
  return {
    user: { id: userId, email, user_metadata: name ? { full_name: name } : {} },
  } as never;
}

describe("アカウントの追加と切り替え", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { replace, origin: "https://life-hub.test", pathname: "/" },
    });
  });

  it("追加したアカウントは、一時領域のセッションを自分専用の置き場所へ移して登録する", () => {
    // 既に1つ目のアカウントが既定のDBを使っている状態。
    localStorage.setItem(
      "lifeHubAccounts",
      JSON.stringify([{ userId: "user-a", email: "a@example.com", name: null, avatarUrl: null, slot: null, dbName: "life-hub", addedAt: 1 }]),
    );
    localStorage.setItem("lifeHubActiveAccount", "user-a");
    setAddingAccount(true);

    finishAddAccount(session("user-b", "b@example.com", "サブ"));

    expect(supabase.moveStoredSession).toHaveBeenCalledWith("pending", "user-b");
    expect(listAccounts()).toMatchObject([
      { userId: "user-a", dbName: "life-hub" },
      { userId: "user-b", name: "サブ", slot: "user-b", dbName: "life-hub-user-b" },
    ]);
    expect(localStorage.getItem("lifeHubActiveAccount")).toBe("user-b");
    expect(localStorage.getItem("lifeHubAddingAccount")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("追加をやめたときのために、1つ目のアカウントのログインには触らない", () => {
    localStorage.setItem(
      "lifeHubAccounts",
      JSON.stringify([{ userId: "user-a", email: "a@example.com", name: null, avatarUrl: null, slot: null, dbName: "life-hub", addedAt: 1 }]),
    );
    setAddingAccount(true);

    finishAddAccount(session("user-b", "b@example.com"));

    // 触るのは一時領域と、追加したアカウント専用の置き場所だけ。
    expect(supabase.moveStoredSession).toHaveBeenCalledTimes(1);
    expect(supabase.clearStoredSession).not.toHaveBeenCalled();
  });

  it("ログアウトすると、そのアカウントだけ外して残っているアカウントに切り替わる", async () => {
    localStorage.setItem(
      "lifeHubAccounts",
      JSON.stringify([
        { userId: "user-a", email: "a@example.com", name: null, avatarUrl: null, slot: null, dbName: "life-hub", addedAt: 1 },
        { userId: "user-b", email: "b@example.com", name: null, avatarUrl: null, slot: "user-b", dbName: "life-hub-user-b", addedAt: 2 },
      ]),
    );
    localStorage.setItem("lifeHubActiveAccount", "user-b");

    await signOutActiveAccount();

    expect(supabase.signOut).toHaveBeenCalledOnce();
    expect(supabase.clearStoredSession).toHaveBeenCalledWith("user-b");
    expect(listAccounts().map((a) => a.userId)).toEqual(["user-a"]);
    expect(localStorage.getItem("lifeHubActiveAccount")).toBe("user-a");
    expect(replace).toHaveBeenCalledWith("/");
  });
});
