// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  fromResult: { data: [] as unknown[], error: null as unknown },
  from: vi.fn(),
  session: { user: { id: "me" } } as { user: { id: string } } | null,
  refreshSharedTrips: vi.fn(async () => {}),
}));

vi.mock("./supabaseData", () => ({
  getSupabaseDataClient: vi.fn(async () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      mocks.from(table);
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        order: () => Promise.resolve(mocks.fromResult),
      };
      return q;
    },
  })),
}));
vi.mock("./supabase", () => ({ auth: { getSession: async () => ({ data: { session: mocks.session } }) } }));
vi.mock("./syncRuntime", () => ({ refreshSharedTrips: mocks.refreshSharedTrips }));

import {
  CollabError,
  classifyCollabError,
  collabErrorText,
  inviteCollaborator,
  inviteMessage,
  isValidInviteEmail,
  leaveSharedTrip,
  listCollaborators,
  listIncomingInvites,
  removeCollaborator,
  respondToInvite,
} from "./tripCollab";
import { subscribeTripMembersChanged } from "./sharedTrips";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "m1",
  trip_id: "t1",
  owner_id: "owner",
  owner_email: "owner@example.com",
  invited_email: "me@example.com",
  member_id: null,
  status: "pending",
  trip_name: "四国旅行",
  trip_destination: "高松",
  trip_start_date: "2026-12-27",
  trip_end_date: "2027-01-02",
  invited_at: "2026-10-13T00:00:00Z",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { id: "m1", status: "pending", alreadyInvited: false }, error: null });
  mocks.fromResult = { data: [], error: null };
  mocks.session = { user: { id: "me" } };
});

describe("classifyCollabError", () => {
  it("サーバーの関数が返す印を、種類に分ける", () => {
    for (const name of ["trip_not_found", "invalid_email", "self_invite", "too_many_members", "invite_not_found", "not_allowed", "login_required"] as const) {
      expect(classifyCollabError({ message: name, code: "P0001" })).toBe(name);
    }
  });

  it("034 が無い時(関数が無い・表が無い)は unavailable、通信の失敗は offline、それ以外は unknown", () => {
    expect(classifyCollabError({ code: "PGRST202", message: "Could not find the function public.invite_trip_member" })).toBe("unavailable");
    expect(classifyCollabError({ code: "42P01", message: 'relation "public.trip_members" does not exist' })).toBe("unavailable");
    expect(classifyCollabError({ code: "", message: "TypeError: Failed to fetch" })).toBe("offline");
    expect(classifyCollabError({ code: "XX000", message: "boom" })).toBe("unknown");
    expect(classifyCollabError(null)).toBe("unknown");
  });

  it("画面に出す文は、種類ごとに日本語になる", () => {
    expect(collabErrorText({ message: "too_many_members" })).toContain("10人");
    expect(collabErrorText(new CollabError("self_invite"))).toContain("自分");
    expect(collabErrorText({ code: "PGRST202", message: "x" })).toContain("まだ使えません");
  });
});

describe("isValidInviteEmail", () => {
  it("形が合っていれば通る(大文字・前後の空白は許す)。形が違うものは通さない", () => {
    expect(isValidInviteEmail(" Friend@Example.com ")).toBe(true);
    expect(isValidInviteEmail("a@b.co")).toBe(true);
    for (const bad of ["", "friend", "friend@", "@example.com", "friend@example", "fr iend@example.com"]) {
      expect(isValidInviteEmail(bad)).toBe(false);
    }
  });
});

describe("招待・参加・外す・抜ける", () => {
  it("招待は、メールアドレスを小文字にそろえて関数に渡し、画面に変化を知らせる", async () => {
    const changes = vi.fn();
    const stop = subscribeTripMembersChanged(changes);
    const result = await inviteCollaborator("t1", "  Friend@Example.COM ");
    stop();
    expect(mocks.rpc).toHaveBeenCalledWith("invite_trip_member", { p_trip_id: "t1", p_email: "friend@example.com" });
    expect(result).toEqual({ id: "m1", status: "pending", alreadyInvited: false });
    expect(changes).toHaveBeenCalledOnce();
  });

  it("関数が断ったら、種類つきのエラーで返す(画面が日本語に直せる)", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "trip_not_found" } });
    await expect(inviteCollaborator("t1", "a@b.co")).rejects.toMatchObject({ name: "CollabError", failure: "trip_not_found" });
  });

  it("参加したら、その旅行をすぐ取り込む。断った時は取り込まない", async () => {
    await respondToInvite("t1", true);
    expect(mocks.rpc).toHaveBeenCalledWith("respond_trip_invite", { p_trip_id: "t1", p_accept: true });
    expect(mocks.refreshSharedTrips).toHaveBeenCalledOnce();
    await respondToInvite("t1", false);
    expect(mocks.rpc).toHaveBeenLastCalledWith("respond_trip_invite", { p_trip_id: "t1", p_accept: false });
    expect(mocks.refreshSharedTrips).toHaveBeenCalledOnce();
  });

  it("抜けたら、この端末の旅行をすぐ片付ける。取り込みの確認が失敗しても、抜けたこと自体は成功", async () => {
    await leaveSharedTrip("t1");
    expect(mocks.rpc).toHaveBeenCalledWith("leave_trip", { p_trip_id: "t1" });
    expect(mocks.refreshSharedTrips).toHaveBeenCalledOnce();
    mocks.refreshSharedTrips.mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(leaveSharedTrip("t1")).resolves.toBeUndefined();
  });

  it("外す・取り消すは、行の id で関数に渡す", async () => {
    await removeCollaborator("m9");
    expect(mocks.rpc).toHaveBeenCalledWith("remove_trip_member", { p_member_row_id: "m9" });
  });
});

describe("一覧", () => {
  it("この旅行の招待・参加者を、画面の形にして返す", async () => {
    mocks.fromResult = { data: [row({ status: "accepted", member_id: "friend", invited_email: "friend@example.com" })], error: null };
    const list = await listCollaborators("t1");
    expect(mocks.from).toHaveBeenCalledWith("trip_members");
    expect(list).toEqual([
      expect.objectContaining({ id: "m1", tripId: "t1", status: "accepted", memberId: "friend", invitedEmail: "friend@example.com", ownerEmail: "owner@example.com", tripName: "四国旅行" }),
    ]);
  });

  it("読めなかった時(034 が無い等)は、種類つきのエラー", async () => {
    mocks.fromResult = { data: null as never, error: { code: "42P01", message: 'relation "public.trip_members" does not exist' } };
    await expect(listCollaborators("t1")).rejects.toMatchObject({ failure: "unavailable" });
  });

  it("自分宛ての招待だけを返す(自分が出した承認待ちは含めない)。読めない・ログインしていない時は空", async () => {
    mocks.fromResult = { data: [row({ id: "to-me" }), row({ id: "mine", owner_id: "me" })], error: null };
    expect((await listIncomingInvites()).map((invite) => invite.id)).toEqual(["to-me"]);
    mocks.fromResult = { data: null as never, error: { code: "42P01", message: "x" } };
    expect(await listIncomingInvites()).toEqual([]);
    mocks.session = null;
    expect(await listIncomingInvites()).toEqual([]);
  });
});

describe("inviteMessage", () => {
  it("旅行の名前・招待先のアドレス・開く場所を入れる", () => {
    const text = inviteMessage("四国旅行", "friend@example.com", "https://life-hub.example");
    expect(text).toContain("四国旅行");
    expect(text).toContain("friend@example.com");
    expect(text).toContain("https://life-hub.example");
  });
});
