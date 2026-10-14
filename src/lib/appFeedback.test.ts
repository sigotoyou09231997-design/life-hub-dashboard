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

import { FeedbackError, answerFeedback, loadIsFeedbackOwner, rowToFeedback, sendFeedback, subscribeFeedbackChanged } from "./appFeedback";

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

  it("画像つきの時だけ新しい窓口(033)で送り、画像なしは今までの窓口のまま(033 を流す前でも送れる)", async () => {
    reply({ ok: true });
    await sendFeedback({ message: "この画面", images: ["data:image/jpeg;base64,AAAA"] });
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.supabase.co/rest/v1/rpc/send_app_feedback_v2");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_images).toEqual(["data:image/jpeg;base64,AAAA"]);
    reply({ ok: true });
    await sendFeedback({ message: "文字だけ", images: [] });
    expect(fetchMock.mock.calls[1][0]).toBe("https://example.supabase.co/rest/v1/rpc/send_app_feedback");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty("p_images");
  });

  it("画像をサーバーが断った時は、画像のことだと分かる文言にする", async () => {
    reply({ ok: false, reason: "invalid_images" });
    await expect(sendFeedback({ message: "x", images: ["data:image/jpeg;base64,AAAA"] })).rejects.toMatchObject({ reason: "invalid_images" });
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

describe("canAttachImages(033 を流した後だけ「画像を付ける」を出す)", () => {
  async function fresh() {
    vi.resetModules();
    return (await import("./appFeedback")).canAttachImages;
  }

  it("確かめる窓口が true を返せば true。確かめるのは1回だけ", async () => {
    const canAttach = await fresh();
    reply(true);
    expect(await canAttach()).toBe(true);
    expect(await canAttach()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.supabase.co/rest/v1/rpc/app_feedback_images_enabled");
  });

  it("窓口が無い(SQL を流していない)・通信できない時は false", async () => {
    let canAttach = await fresh();
    reply({ code: "PGRST202", message: "Could not find the function" }, 404);
    expect(await canAttach()).toBe(false);
    canAttach = await fresh();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await canAttach()).toBe(false);
  });
});

describe("feedbackStatusLabel(状態の名前)", () => {
  it("対応待ち・対応中・保留中・対応済み・見送り。知らない状態は対応待ちとして出す", async () => {
    const { feedbackStatusLabel } = await import("./appFeedback");
    expect(feedbackStatusLabel("new")).toBe("対応待ち");
    expect(feedbackStatusLabel("working")).toBe("対応中");
    expect(feedbackStatusLabel("hold")).toBe("保留中");
    expect(feedbackStatusLabel("done")).toBe("対応済み");
    expect(feedbackStatusLabel("dismissed")).toBe("見送り");
    expect(feedbackStatusLabel("something-new")).toBe("対応待ち");
  });
});

describe("answerFeedback(保留中の質問に、ボタンで答える。2026-10-14)", () => {
  it("ログインしている人の鍵で、依頼の id と答えを送る。通ったら、状況の読み直しを呼ぶ", async () => {
    mocks.session = { access_token: "user-token", user: { id: "u1" } };
    reply({ ok: true });
    let changed = 0;
    const stop = subscribeFeedbackChanged(() => (changed += 1));
    await answerFeedback("f1", "PCで左右に並べる");
    stop();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/rest/v1/rpc/app_feedback_answer");
    expect(init.headers.Authorization).toBe("Bearer user-token");
    expect(JSON.parse(init.body)).toEqual({ p_id: "f1", p_answer: "PCで左右に並べる" });
    expect(changed).toBe(1);
  });

  it("ログインしていない・サーバーが断った・関数が無い(039 を流す前)・通信できない時は、FeedbackError", async () => {
    await expect(answerFeedback("f1", "A")).rejects.toMatchObject({ reason: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
    mocks.session = { access_token: "user-token", user: { id: "u1" } };
    reply({ ok: false, reason: "not_asking" });
    await expect(answerFeedback("f1", "A")).rejects.toBeInstanceOf(FeedbackError);
    reply({ code: "PGRST202", message: "function not found" }, 404);
    await expect(answerFeedback("f1", "A")).rejects.toMatchObject({ reason: "unavailable" });
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(answerFeedback("f1", "A")).rejects.toMatchObject({ reason: "failed" });
  });
});

describe("rowToFeedback: 質問と答え(039)", () => {
  const base = { id: "f1", via: "app" as const, sender_name: null, trip_name: null, page: null, message: "m", app_version: null, status: "hold" as const, created_at: "2026-10-14T00:00:00Z" };

  it("選択肢・答え・答えた時刻を読む。文字でない選択肢は捨てる。無ければ未設定", () => {
    expect(rowToFeedback({ ...base, question_options: ["A", 5, "B"], answer: "A", answered_at: "2026-10-14T01:00:00Z" })).toMatchObject({
      questionOptions: ["A", "B"],
      answer: "A",
      answeredAt: "2026-10-14T01:00:00Z",
    });
    const plain = rowToFeedback(base);
    expect(plain.questionOptions).toBeUndefined();
    expect(plain.answer).toBeUndefined();
  });
});
