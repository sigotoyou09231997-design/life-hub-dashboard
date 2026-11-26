// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** デモ(`/demo`)は、本物のアカウントのデータ・ログイン・同期に触らないことが一番大事。
 * それを支えているのは「起動時に、DB名・ログインの保存枠・Supabaseの設定の有無を、デモ用に差し替える」
 * の一点なので、ここを押さえる。 */
describe("デモモード", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("ふだん(印も /demo も無い)は、今まで通り本物のDBを開く", async () => {
    const demo = await import("./demoMode");
    const { db } = await import("../db/schema");
    expect(demo.IS_DEMO).toBe(false);
    expect(db.name).toBe("life-hub");
  });

  it("/demo を開くと、デモ用のDB・空のログイン枠を使い、Supabaseは未設定扱いになる", async () => {
    window.history.replaceState(null, "", "/demo");
    const demo = await import("./demoMode");
    const accounts = await import("./accounts");
    const { isSupabaseConfigured } = await import("./supabase");
    const { db } = await import("../db/schema");

    expect(demo.IS_DEMO).toBe(true);
    expect(demo.IS_DEMO_ENTRY).toBe(true);
    expect(db.name).toBe("life-hub-demo");
    expect(accounts.BOOT_SLOT).toBe("demo");
    expect(isSupabaseConfigured).toBe(false);
    // localStorage のキーもデモ専用になる(同期カーソルなど、本物の記録を書き換えない)。
    expect(accounts.scopedKey("syncCursor")).toBe("life-hub-demo:syncCursor");
  });

  it("一度入ると、同じタブでホーム(/)に移ってもデモのまま(印はそのタブの sessionStorage に残る)", async () => {
    window.history.replaceState(null, "", "/demo");
    await import("./demoMode");
    vi.resetModules();
    window.history.replaceState(null, "", "/");

    const demo = await import("./demoMode");
    const { db } = await import("../db/schema");
    expect(demo.IS_DEMO).toBe(true);
    expect(demo.IS_DEMO_ENTRY).toBe(false);
    expect(db.name).toBe("life-hub-demo");
  });

  it("本物のアカウントを選んでいる端末でも、デモはそのアカウントのDBとセッションを使わない", async () => {
    localStorage.setItem(
      "lifeHubAccounts",
      JSON.stringify([{ userId: "user-a", email: null, name: null, avatarUrl: null, slot: "a1", dbName: "life-hub-user-a", addedAt: 1 }]),
    );
    localStorage.setItem("lifeHubActiveAccount", "user-a");
    window.history.replaceState(null, "", "/demo");

    const accounts = await import("./accounts");
    const { db } = await import("../db/schema");
    expect(db.name).toBe("life-hub-demo");
    expect(accounts.BOOT_SLOT).toBe("demo");
  });

  it("デモを終わると、印を消してデモのDBを消し、ふだんの画面へ戻る", async () => {
    window.history.replaceState(null, "", "/demo");
    const demo = await import("./demoMode");
    const replace = vi.fn();
    const deleteDatabase = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, replace } });
    Object.defineProperty(window, "indexedDB", { configurable: true, value: { deleteDatabase } });
    try {
      demo.exitDemo();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }

    expect(localStorage.getItem("lifehub:demo")).toBeNull();
    expect(sessionStorage.getItem("lifehub:demo")).toBeNull();
    expect(deleteDatabase).toHaveBeenCalledWith("life-hub-demo");
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("デモでは、AI の窓口(本人の料金がかかる)をサーバーへ送らずに断る。ほかの窓口はそのまま通す", async () => {
    window.history.replaceState(null, "", "/demo");
    const sent: string[] = [];
    const originalFetch = window.fetch;
    window.fetch = (async (input: RequestInfo | URL) => {
      sent.push(String(input));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const demo = await import("./demoMode");
      demo.installDemoApiGuard();
      const blocked = await window.fetch("/api/extractReceipt", { method: "POST" });
      expect(blocked.status).toBe(403);
      expect(((await blocked.json()) as { error: string }).error).toBe(demo.DEMO_BLOCKED_MESSAGE);
      expect((await window.fetch("/api/extractTripPlan")).status).toBe(403);
      expect((await window.fetch("/api/suggestPlaces")).status).toBe(403);
      expect((await window.fetch("/api/soccer?kind=news")).status).toBe(200);
      expect(sent).toEqual(["/api/soccer?kind=news"]);
    } finally {
      window.fetch = originalFetch;
    }
  });

  it("ふだんは、AI の窓口も止めない", async () => {
    const originalFetch = window.fetch;
    const stub = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    window.fetch = stub;
    try {
      const demo = await import("./demoMode");
      demo.installDemoApiGuard();
      expect(window.fetch).toBe(stub);
    } finally {
      window.fetch = originalFetch;
    }
  });

  it("デモの印はそのタブの中だけ: ほかのタブ(sessionStorage が空)は、ふだんの LIFE HUB のまま", async () => {
    window.history.replaceState(null, "", "/demo");
    await import("./demoMode");
    expect(sessionStorage.getItem("lifehub:demo")).toBe("1");
    expect(localStorage.getItem("lifehub:demo")).toBeNull();

    // 別のタブを開いた状態(同じ端末の localStorage は共有、sessionStorage は空)。
    vi.resetModules();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    const demo = await import("./demoMode");
    const { db } = await import("../db/schema");
    expect(demo.IS_DEMO).toBe(false);
    expect(db.name).toBe("life-hub");
  });

  it("前の版が localStorage に残したデモの印は効かせず、消す(端末ごとデモになったままにしない)", async () => {
    localStorage.setItem("lifehub:demo", "1");
    const demo = await import("./demoMode");
    const { isSupabaseConfigured } = await import("./supabase");
    expect(demo.IS_DEMO).toBe(false);
    expect(localStorage.getItem("lifehub:demo")).toBeNull();
    // テスト環境は Supabase 未設定なので false のまま。デモのせいで false になったのではないことは、IS_DEMO で確かめている。
    expect(typeof isSupabaseConfigured).toBe("boolean");
  });
});
