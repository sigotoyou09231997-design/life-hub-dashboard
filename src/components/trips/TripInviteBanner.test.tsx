/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Collaborator } from "../../lib/tripCollab";

const mocks = vi.hoisted(() => ({
  invites: [] as Collaborator[],
  responded: [] as { tripId: string; accept: boolean }[],
  respondError: null as Error | null,
  toasts: [] as string[],
}));

vi.mock("../../hooks/useTripCollab", () => ({ useIncomingInvites: () => mocks.invites, useIsSharedWithMe: () => false }));
vi.mock("../../lib/tripCollab", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tripCollab")>("../../lib/tripCollab");
  return {
    ...actual,
    respondToInvite: async (tripId: string, accept: boolean) => {
      if (mocks.respondError) throw mocks.respondError;
      mocks.responded.push({ tripId, accept });
    },
  };
});
vi.mock("../ui/ToastProvider", () => ({ useToast: () => (message: string) => void mocks.toasts.push(message) }));

import { CollabError } from "../../lib/tripCollab";
import { TripInviteBanner } from "./TripInviteBanner";

const invite = (overrides: Partial<Collaborator> = {}): Collaborator => ({
  id: "m1",
  tripId: "t1",
  ownerId: "owner",
  ownerEmail: "owner@example.com",
  invitedEmail: "me@example.com",
  memberId: null,
  status: "pending",
  tripName: "四国旅行",
  tripDestination: "高松",
  tripStartDate: "2026-12-27",
  tripEndDate: "2027-01-02",
  invitedAt: "2026-10-13T00:00:00Z",
  ...overrides,
});

describe("TripInviteBanner", () => {
  beforeEach(() => {
    mocks.invites = [];
    mocks.responded = [];
    mocks.respondError = null;
    mocks.toasts = [];
  });
  afterEach(cleanup);

  it("招待が無い間は、何も出さない", () => {
    const { container } = render(<TripInviteBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("誰から・どの旅行か（行き先と日付）・共有の範囲を出す。参加と断るは別々のボタン", () => {
    mocks.invites = [invite()];
    render(<TripInviteBanner />);
    expect(screen.getByText(/owner@example.com さんから、旅行「四国旅行」への招待/)).toBeTruthy();
    expect(screen.getByText(/高松 · 12月27日/)).toBeTruthy();
    expect(screen.getByText(/日記・写真・書類は共有されません/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "参加する" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "断る" })).toBeTruthy();
  });

  it("参加するを押すと、その旅行に参加して知らせる。断ると、断って知らせる", async () => {
    mocks.invites = [invite()];
    render(<TripInviteBanner />);
    await userEvent.click(screen.getByRole("button", { name: "参加する" }));
    await waitFor(() => expect(mocks.responded).toEqual([{ tripId: "t1", accept: true }]));
    expect(mocks.toasts.at(-1)).toBe("「四国旅行」に参加しました");
    await userEvent.click(screen.getByRole("button", { name: "断る" }));
    await waitFor(() => expect(mocks.responded.at(-1)).toEqual({ tripId: "t1", accept: false }));
    expect(mocks.toasts.at(-1)).toBe("招待を断りました");
  });

  it("答えられなかった時は、理由を日本語で出す", async () => {
    mocks.invites = [invite()];
    mocks.respondError = new CollabError("invite_not_found");
    render(<TripInviteBanner />);
    await userEvent.click(screen.getByRole("button", { name: "参加する" }));
    await waitFor(() => expect(mocks.toasts.at(-1)).toContain("見つかりません"));
  });

  it("招待が複数あれば、1件ずつ出る", () => {
    mocks.invites = [invite(), invite({ id: "m2", tripId: "t2", tripName: "北海道" })];
    render(<TripInviteBanner />);
    expect(screen.getAllByRole("button", { name: "参加する" })).toHaveLength(2);
  });
});
