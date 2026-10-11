import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as null | { access_token: string; user: { id: string } },
  ownerRow: null as null | { user_id: string },
  ownerError: null as null | { code?: string; message: string },
}));

vi.mock("./supabase", () => ({
  isSupabaseConfigured: true,
  getSupabaseConfig: () => ({ url: "https://example.supabase.co", anonKey: "anon-key" }),
  auth: { getSession: async () => ({ data: { session: mocks.session } }) },
}));

vi.mock("./supabaseData", () => ({
  getSupabaseDataClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.ownerRow, error: mocks.ownerError }) }) }),
    }),
  }),
}));

import { FeedbackError, loadIsFeedbackOwner, sendFeedback } from "./appFeedback";

let fetchMock: ReturnType<typeof vi.fn>;

function reply(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  mocks.session = null;
  mocks.ownerRow = null;
  mocks.ownerError = null;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("sendFeedback", () => {
  it("ログインしていればその人の鍵で、要望・画面・名乗りを送る", async () => {
    mocks.session = { access_token: "user-token", user: { id: "u1" } };
    reply({ ok: true });
    await sendFeedback({ message: "  ボタンが小さい  ", page: "/trips/a", senderName: " 友人A " });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/rest/v1/rpc/send_app_feedback");
    expect(init.headers.Authorization).toBe("Bearer user-token");
    expect(JSON.parse(init.body)).toMatchObject({ p_message: "ボタンが小さい", p_page: "/trips/a", p_sender_name: "友人A", p_share_token: null });
  });

  it("ログインしていなければ公開鍵と、共有リンクの合鍵で送る", async () => {
    reply({ ok: true });
    await sendFeedback({ message: "しおりの時刻が違う", page: "/share/trip/x", shareToken: "tok" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer anon-key");
    expect(JSON.parse(init.body).p_share_token).toBe("tok");
  });

  it("空・長すぎる要望は、送る前に断る", async () => {
    await expect(sendFeedback({ message: "   " })).rejects.toMatchObject({ reason: "invalid_message" });
    await expect(sendFeedback({ message: "あ".repeat(2001) })).rejects.toMatchObject({ reason: "invalid_message" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("サーバーが断った理由を、そのまま画面の文言にする", async () => {
    reply({ ok: false, reason: "too_many" });
    const error = await sendFeedback({ message: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FeedbackError);
    expect((error as FeedbackError).message).toMatch(/送りすぎ/);
  });

  it("受信箱の SQL がまだ流れていない時は「準備中」", async () => {
    reply({ code: "PGRST202", message: "Could not find the function" }, 404);
    await expect(sendFeedback({ message: "x" })).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("通信できない時は、そう知らせる", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(sendFeedback({ message: "x" })).rejects.toMatchObject({ reason: "failed" });
  });
});

describe("loadIsFeedbackOwner", () => {
  it("ログインしている人が持ち主の時だけ true", async () => {
    mocks.session = { access_token: "t", user: { id: "owner" } };
    mocks.ownerRow = { user_id: "owner" };
    expect(await loadIsFeedbackOwner()).toBe(true);
    mocks.ownerRow = { user_id: "someone-else" };
    expect(await loadIsFeedbackOwner()).toBe(false);
  });

  it("ログインしていない・表がまだ無い時は false(受信箱を出さない)", async () => {
    expect(await loadIsFeedbackOwner()).toBe(false);
    mocks.session = { access_token: "t", user: { id: "owner" } };
    mocks.ownerError = { code: "PGRST205", message: "missing" };
    expect(await loadIsFeedbackOwner()).toBe(false);
  });
});
