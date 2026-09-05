// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const state = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  startSync: vi.fn(),
  stopSync: vi.fn(),
}));

vi.mock("./lib/supabase", () => ({
  isSupabaseConfigured: true,
  auth: { getSession: state.getSession, onAuthStateChange: state.onAuthStateChange, signOut: vi.fn() },
  authStorageKey: (slot: string | null) => (slot === null ? "sb-test-auth-token" : `sb-test-auth-token-${slot}`),
  moveStoredSession: vi.fn(),
  clearStoredSession: vi.fn(),
  getSupabaseConfig: () => ({ url: "https://test.supabase.co", anonKey: "anon-key" }),
}));
vi.mock("./lib/syncRuntime", () => ({ startSync: state.startSync, stopSync: state.stopSync }));
vi.mock("./lib/pushNotifications", () => ({ clearShownPushNotifications: vi.fn() }));
vi.mock("./db/schema", () => ({
  ensureDefaultSettings: vi.fn(),
  db: {
    transactions: {}, fixedCosts: {}, calendarEvents: {}, tasks: {}, notes: {},
    salaries: {}, trips: {}, tripSchedule: {}, tripExpenses: {}, tripPackingItems: {}, paypayTransactions: {},
  },
}));
vi.mock("./pages/AuthGatePage", () => ({ default: () => <div>Login gate</div> }));
vi.mock("./pages/TopPage", () => ({ default: () => <div>Home page</div> }));
vi.mock("./pages/AuthCallbackPage", () => ({ default: () => <div>Auth callback</div> }));
vi.mock("./components/layout/AmbientBackground", () => ({ AmbientBackground: () => null }));
vi.mock("./components/layout/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("./components/layout/DesktopSidebar", () => ({ DesktopSidebar: () => null }));
vi.mock("./components/layout/QuickActionBar", () => ({ QuickActionBar: () => null }));
vi.mock("./components/ui/UpdateBanner", () => ({ UpdateBanner: () => null }));

describe("App authentication bootstrap", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    state.startSync.mockResolvedValue(undefined);
    state.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  });

  it("shows the login gate after an unsigned-in startup", async () => {
    state.getSession.mockResolvedValue({ data: { session: null } });
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(await screen.findByText("Login gate")).toBeTruthy();
  });

  it("restores an existing session and shows Home", async () => {
    state.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" }, access_token: "token-1" } } });
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(await screen.findByText("Home page")).toBeTruthy();
    await waitFor(() => expect(state.startSync).toHaveBeenCalledWith("user-1", "token-1"));
  });

  it("記録の無い端末でログインすると、そのアカウントを端末の一覧に登録する", async () => {
    localStorage.clear();
    state.getSession.mockResolvedValue({
      data: { session: { user: { id: "user-1", email: "a@example.com", user_metadata: {} }, access_token: "token-1" } },
    });
    render(<MemoryRouter><App /></MemoryRouter>);
    await screen.findByText("Home page");

    await waitFor(() => {
      const accounts = JSON.parse(localStorage.getItem("lifeHubAccounts") ?? "[]");
      // 1つ目のアカウントは、この機能より前から端末にある既定のDBをそのまま引き継ぐ。
      expect(accounts).toMatchObject([{ userId: "user-1", email: "a@example.com", slot: null, dbName: "life-hub" }]);
    });
    expect(localStorage.getItem("lifeHubActiveAccount")).toBe("user-1");
  });

  /** 旅行のしおりの共有(supabase/sql/023_trip_shares.sql)。この1ルートだけが
   *  ログインの壁の外にある — 中に入れてしまうと、共有された人はアカウントを
   *  作らないと開けず、機能そのものが成り立たない。 */
  describe("共有リンク (/share/trip/:token)", () => {
    const SHARED = {
      includeExpenses: false,
      trip: { name: "台北3日", destination: "台北", startDate: "2026-10-01", endDate: "2026-10-03", status: "planning" },
      schedule: [],
      packing: [],
      route: [],
      expenses: [],
    };

    // 共有ページは lazy 読み込みなので、最初の1回だけ読み込みに時間がかかり、
    // findByText の既定の待ち時間(1秒)を超えることがある。先に読ませておく。
    beforeEach(async () => {
      await import("./pages/SharedTripPage");
    });

    it("ログインしていなくても、しおりを出す(同期も始めない)", async () => {
      state.getSession.mockResolvedValue({ data: { session: null } });
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => SHARED }) as unknown as Response));
      render(
        <MemoryRouter initialEntries={["/share/trip/token-1"]}>
          <App />
        </MemoryRouter>,
      );
      expect(await screen.findByText("台北3日")).toBeTruthy();
      expect(screen.queryByText("Login gate")).toBeNull();
      expect(state.startSync).not.toHaveBeenCalled();
      // 検索エンジンに拾わせない。
      expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
    });

    it("共有が終わっていれば、その旨を出す", async () => {
      state.getSession.mockResolvedValue({ data: { session: null } });
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => null }) as unknown as Response));
      render(
        <MemoryRouter initialEntries={["/share/trip/token-gone"]}>
          <App />
        </MemoryRouter>,
      );
      expect(await screen.findByText("共有は終了しました")).toBeTruthy();
    });
  });
});
