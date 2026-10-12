/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Collaborator } from "../../lib/tripCollab";

const mocks = vi.hoisted(() => ({
  list: [] as Collaborator[],
  listError: null as Error | null,
  invited: [] as { tripId: string; email: string }[],
  inviteError: null as Error | null,
  removed: [] as string[],
  left: [] as string[],
  toasts: [] as string[],
}));

vi.mock("../../lib/tripCollab", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tripCollab")>("../../lib/tripCollab");
  return {
    ...actual,
    listCollaborators: async () => {
      if (mocks.listError) throw mocks.listError;
      return mocks.list;
    },
    inviteCollaborator: async (tripId: string, email: string) => {
      if (mocks.inviteError) throw mocks.inviteError;
      mocks.invited.push({ tripId, email });
      return { id: "new", alreadyInvited: false };
    },
    removeCollaborator: async (id: string) => void mocks.removed.push(id),
    leaveSharedTrip: async (tripId: string) => void mocks.left.push(tripId),
  };
});
vi.mock("../ui/ToastProvider", () => ({ useToast: () => (message: string) => void mocks.toasts.push(message) }));

import { CollabError } from "../../lib/tripCollab";
import { ConfirmProvider } from "../ui/ConfirmProvider";
import { TripCollabSheet } from "./TripCollabSheet";

const member = (overrides: Partial<Collaborator>): Collaborator => ({
  id: "m",
  tripId: "t1",
  ownerId: "owner",
  ownerEmail: "owner@example.com",
  invitedEmail: "friend@example.com",
  memberId: "friend",
  status: "accepted",
  tripName: "四国旅行",
  tripDestination: "高松",
  tripStartDate: "2026-12-27",
  tripEndDate: "2027-01-02",
  invitedAt: "2026-10-13T00:00:00Z",
  ...overrides,
});

function renderSheet(role: "owner" | "member", onLeft = vi.fn(), onClose = vi.fn()) {
  render(<TripCollabSheet tripId="t1" tripName="四国旅行" role={role} onClose={onClose} onLeft={onLeft} />, { wrapper: ConfirmProvider });
  return { onLeft, onClose };
}

describe("TripCollabSheet", () => {
  beforeEach(() => {
    mocks.list = [];
    mocks.listError = null;
    mocks.invited = [];
    mocks.inviteError = null;
    mocks.removed = [];
    mocks.left = [];
    mocks.toasts = [];
  });
  afterEach(cleanup);

  describe("持ち主", () => {
    it("参加中の人と承認待ちの人が並ぶ。まだ誰もいなければ、その旨が出る", async () => {
      mocks.list = [member({ id: "a" }), member({ id: "b", invitedEmail: "wait@example.com", memberId: null, status: "pending" })];
      renderSheet("owner");
      expect(await screen.findByText("fr***@example.com")).toBeTruthy();
      expect(screen.getByText("wa***@example.com")).toBeTruthy();
      // 全部のアドレスは、画面のどこにも出さない
      expect(document.body.textContent).not.toContain("friend@example.com");
      expect(document.body.textContent).not.toContain("wait@example.com");
      expect(screen.getByText("参加中")).toBeTruthy();
      expect(screen.getByText("承認待ち")).toBeTruthy();
      expect(screen.getByRole("button", { name: "外す" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "取り消す" })).toBeTruthy();
      cleanup();
      mocks.list = [];
      renderSheet("owner");
      expect(await screen.findByText("まだ誰も招待していません。")).toBeTruthy();
    });

    it("メールアドレスの形が合うまで「招待する」は押せない。招待すると小文字にそろえて送り、入力欄を空にする", async () => {
      renderSheet("owner");
      const input = await screen.findByLabelText(/招待するメールアドレス/);
      const button = screen.getByRole("button", { name: "招待する" }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      await userEvent.type(input, "friend@example");
      expect(button.disabled).toBe(true);
      await userEvent.clear(input);
      await userEvent.type(input, "Friend@Example.com");
      expect(button.disabled).toBe(false);
      await userEvent.click(button);
      await waitFor(() => expect(mocks.invited).toEqual([{ tripId: "t1", email: "Friend@Example.com" }]));
      await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
      expect(mocks.toasts.at(-1)).toContain("招待しました");
    });

    it("招待が断られたら、理由を日本語で出す(入力はそのまま残す)", async () => {
      mocks.inviteError = new CollabError("trip_not_found");
      renderSheet("owner");
      const input = await screen.findByLabelText(/招待するメールアドレス/);
      await userEvent.type(input, "friend@example.com");
      await userEvent.click(screen.getByRole("button", { name: "招待する" }));
      await waitFor(() => expect(mocks.toasts.at(-1)).toContain("同期してから"));
      expect((input as HTMLInputElement).value).toBe("friend@example.com");
    });

    it("参加者を外す時は、確認してから外す。確認で止めたら外さない", async () => {
      mocks.list = [member({ id: "a" })];
      renderSheet("owner");
      await userEvent.click(await screen.findByRole("button", { name: "外す" }));
      expect(await screen.findByText(/外した瞬間から/)).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
      expect(mocks.removed).toEqual([]);
      // もう一度開いて、今度は確認で「外す」。確認のシートの「外す」は、一覧の「外す」より後ろに出る。
      await userEvent.click(screen.getByRole("button", { name: "外す" }));
      const buttons = await screen.findAllByRole("button", { name: "外す" });
      await userEvent.click(buttons[buttons.length - 1]);
      await waitFor(() => expect(mocks.removed).toEqual(["a"]));
    });

    it("承認待ちの人には、招待の案内をコピーするボタンが付く", async () => {
      mocks.list = [member({ id: "b", invitedEmail: "wait@example.com", memberId: null, status: "pending" })];
      renderSheet("owner");
      expect(await screen.findByRole("button", { name: "招待の案内をコピー" })).toBeTruthy();
    });
  });

  describe("参加している人", () => {
    it("持ち主と参加者が見える。招待・外すは出ない", async () => {
      mocks.list = [member({ id: "a" }), member({ id: "c", invitedEmail: "third@example.com", memberId: "third" })];
      renderSheet("member");
      expect(await screen.findByText(/ow\*\*\*@example.com さんの旅行に参加しています/)).toBeTruthy();
      expect(document.body.textContent).not.toContain("owner@example.com");
      expect(screen.getByText("持ち主")).toBeTruthy();
      expect(screen.getByText("fr***@example.com")).toBeTruthy();
      expect(screen.queryByLabelText(/招待するメールアドレス/)).toBeNull();
      expect(screen.queryByRole("button", { name: "外す" })).toBeNull();
    });

    it("抜ける時は、確認してから抜けて、閉じて、旅行の画面を離れる", async () => {
      mocks.list = [member({ id: "a" })];
      const { onLeft, onClose } = renderSheet("member");
      await userEvent.click(await screen.findByRole("button", { name: "この旅行から抜ける" }));
      expect(await screen.findByText(/この端末からこの旅行が消えます/)).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "抜ける" }));
      await waitFor(() => expect(mocks.left).toEqual(["t1"]));
      await waitFor(() => expect(onLeft).toHaveBeenCalledOnce());
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("一覧を読めなかった時(034 が無い・通信できない)は、その理由を出す", async () => {
    mocks.listError = new CollabError("unavailable");
    renderSheet("owner");
    expect((await screen.findByRole("alert")).textContent).toContain("まだ使えません");
  });
});
