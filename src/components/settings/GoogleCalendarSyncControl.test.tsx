/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmailAccount } from "../../types";
import { ToastProvider } from "../ui/ToastProvider";

const mocks = vi.hoisted(() => ({
  updates: [] as { id: string; changes: Record<string, unknown> }[],
  oauthStarted: 0,
  synced: [] as GmailAccount[],
}));

vi.mock("../../db/schema", () => ({
  db: {
    gmailAccounts: {
      update: async (id: string, changes: Record<string, unknown>) => {
        mocks.updates.push({ id, changes });
        return 1;
      },
    },
  },
}));

vi.mock("../../lib/gmail", () => ({
  GOOGLE_CALENDAR_SCOPE: "https://www.googleapis.com/auth/calendar.events",
  startGmailOAuth: () => {
    mocks.oauthStarted += 1;
  },
  ensureFreshAccessToken: async (account: GmailAccount) => account,
  htmlToText: (html: string) => html,
}));

// 取り込みそのものは src/lib/googleCalendar.test.ts で見る。ここでは呼ばれたかだけ。
vi.mock("../../lib/googleCalendar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/googleCalendar")>()),
  syncGoogleCalendar: async (account: GmailAccount) => {
    mocks.synced.push(account);
    return { added: 0, updated: 0, deleted: 0, skipped: 0, baselined: true, error: null };
  },
}));

import { GoogleCalendarSyncControl } from "./GoogleCalendarSyncControl";

const base: GmailAccount = {
  id: "acc-1",
  email: "me@example.com",
  accessToken: "a",
  accessTokenExpiresAt: 0,
  refreshToken: "r",
  connectedAt: 0,
};
const withScope: GmailAccount = { ...base, grantedScopes: "openid email https://www.googleapis.com/auth/calendar.events" };

function renderControl(account: GmailAccount) {
  return render(
    <ToastProvider>
      <GoogleCalendarSyncControl account={account} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  mocks.updates = [];
  mocks.oauthStarted = 0;
  mocks.synced = [];
  sessionStorage.clear();
});

afterEach(cleanup);

describe("設定のGoogleカレンダー取り込み", () => {
  it("この機能より前に連携したアカウントは、つなぎ直しを出し、戻ったら入にする控えを残す", async () => {
    const user = userEvent.setup();
    renderControl(base);
    expect(screen.queryByRole("switch")).toBeNull();
    await user.click(screen.getByRole("button", { name: "つなぎ直してカレンダーも許可する" }));
    expect(mocks.oauthStarted).toBe(1);
    expect(sessionStorage.getItem("googleCalendarEnableAfterConnect")).toBe("me@example.com");
  });

  it("入にすると、起点を捨ててから取り込み(起点の取得)を始める", async () => {
    const user = userEvent.setup();
    renderControl(withScope);
    const toggle = screen.getByRole("switch", { name: /Googleカレンダーから予定を取り込む/ });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.click(toggle);
    await waitFor(() => expect(mocks.synced).toHaveLength(1));
    expect(mocks.updates[0].changes).toEqual(
      expect.objectContaining({ calendarSyncEnabledAt: expect.any(Number), calendarSyncToken: undefined }),
    );
    expect(mocks.synced[0].calendarSyncToken).toBeUndefined();
  });

  it("切っても取り込み済みの予定は消さず、次に入にした時のために起点だけ捨てる", async () => {
    const user = userEvent.setup();
    renderControl({ ...withScope, calendarSyncEnabledAt: 1, calendarSyncToken: "t", calendarLastSyncedAt: Date.now() });
    await user.click(screen.getByRole("switch", { name: /Googleカレンダーから予定を取り込む/ }));
    expect(mocks.updates).toEqual([
      { id: "acc-1", changes: { calendarSyncEnabledAt: 0, calendarSyncToken: undefined, calendarSyncError: "" } },
    ]);
    expect(mocks.synced).toHaveLength(0);
  });

  it("前回の失敗の理由を、そのまま出す", () => {
    renderControl({ ...withScope, calendarSyncEnabledAt: 1, calendarSyncError: "Google Calendar API が有効になっていません" });
    expect(screen.getByText("Google Calendar API が有効になっていません")).toBeTruthy();
    expect(screen.getByRole("button", { name: "今すぐ取り込む" })).toBeTruthy();
  });
});
