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
  auth: { getSession: state.getSession, onAuthStateChange: state.onAuthStateChange },
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
});
