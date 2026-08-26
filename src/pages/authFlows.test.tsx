// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/ToastProvider";
import AuthGatePage from "./AuthGatePage";
import AuthCallbackPage from "./AuthCallbackPage";
import AccountPage from "./AccountPage";

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  auth,
  getRedirectUri: () => "https://life-hub.test/auth/callback",
  authStorageKey: (slot: string | null) => (slot === null ? "sb-test-auth-token" : `sb-test-auth-token-${slot}`),
  moveStoredSession: vi.fn(),
  clearStoredSession: vi.fn(),
}));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => [] }));
vi.mock("../lib/syncRuntime", () => ({ syncNow: vi.fn() }));

function renderWithToast(ui: React.ReactNode) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("Supabase authentication flows", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    auth.signInWithPassword.mockResolvedValue({ error: null });
    auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    auth.signOut.mockResolvedValue({ error: null });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  });

  it("logs in with email and password", async () => {
    const user = userEvent.setup();
    renderWithToast(<AuthGatePage />);

    await user.click(screen.getByRole("button", { name: "ログイン" }));
    await user.type(screen.getByLabelText("メールアドレス"), "person@example.com");
    await user.type(screen.getByLabelText("パスワード"), "secret12");
    fireEvent.submit(screen.getAllByRole("button", { name: "ログイン" })[1].closest("form")!);

    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "secret12",
    }));
  });

  it("starts Google OAuth with the Auth Callback redirect", async () => {
    const user = userEvent.setup();
    renderWithToast(<AuthGatePage />);

    await user.click(screen.getByRole("button", { name: "Googleでログイン" }));

    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://life-hub.test/auth/callback" },
    });
  });

  it("restores the Auth Callback session and navigates to Settings", async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { email: "person@example.com" } } },
    });

    renderWithToast(
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/settings" element={<div>Settings reached</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Settings reached")).toBeTruthy();
    expect(auth.onAuthStateChange).toHaveBeenCalledOnce();
    expect(auth.getSession).toHaveBeenCalledOnce();
  });

  it("logs out from Account", async () => {
    const session = { user: { id: "user-1", email: "person@example.com", user_metadata: {} } };
    auth.getSession.mockResolvedValue({ data: { session } });
    localStorage.setItem(
      "lifeHubAccounts",
      JSON.stringify([{ userId: "user-1", email: "person@example.com", name: null, avatarUrl: null, slot: null, dbName: "life-hub", addedAt: 1 }]),
    );
    localStorage.setItem("lifeHubActiveAccount", "user-1");
    const user = userEvent.setup();
    renderWithToast(<MemoryRouter><AccountPage /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "ログアウト" }));

    expect(auth.signOut).toHaveBeenCalledOnce();
    // ログアウトしたアカウントは、この端末の切り替え一覧から外れる。
    await waitFor(() => expect(JSON.parse(localStorage.getItem("lifeHubAccounts") ?? "[]")).toEqual([]));
  });

  it("アカウント画面に、登録済みのアカウントと追加ボタンが並ぶ", async () => {
    const session = { user: { id: "user-1", email: "person@example.com", user_metadata: {} } };
    auth.getSession.mockResolvedValue({ data: { session } });
    localStorage.setItem(
      "lifeHubAccounts",
      JSON.stringify([
        { userId: "user-1", email: "person@example.com", name: "本人", avatarUrl: null, slot: null, dbName: "life-hub", addedAt: 1 },
        { userId: "user-2", email: "sub@example.com", name: "サブ", avatarUrl: null, slot: "user-2", dbName: "life-hub-user-2", addedAt: 2 },
      ]),
    );
    localStorage.setItem("lifeHubActiveAccount", "user-1");
    renderWithToast(<MemoryRouter><AccountPage /></MemoryRouter>);

    expect(await screen.findByText("サブ")).toBeTruthy();
    // ログイン中でない方にだけ切り替えボタンが出る。
    expect(screen.getAllByRole("button", { name: "切り替え" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "アカウントを追加" })).toBeTruthy();
  });
});
