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
    const user = userEvent.setup();
    renderWithToast(<MemoryRouter><AccountPage /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "ログアウト" }));

    expect(auth.signOut).toHaveBeenCalledOnce();
  });
});
