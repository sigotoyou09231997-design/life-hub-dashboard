import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CANDIDATES,
  MAX_PLACES,
  buildUserMessage,
  cleanText,
  handler as netlifyHandler,
  parseSuggestions,
  readBody,
  suggestPlaces,
  SYSTEM_PROMPT,
} from "../functions/suggestPlaces";
import vercelHandler, {
  parseSuggestions as vercelParseSuggestions,
  readBody as vercelReadBody,
  suggestPlaces as vercelSuggestPlaces,
  SYSTEM_PROMPT as VERCEL_SYSTEM_PROMPT,
} from "../../api/suggestPlaces";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const ASKED = ["霊山寺", "児島駅", "昼食"];

function aiReply(items: unknown, extra: Record<string, unknown> = {}) {
  return { content: [{ type: "thinking" }, { type: "text", text: JSON.stringify({ items }) }], stop_reason: "end_turn", usage: { input_tokens: 1500, output_tokens: 700 }, ...extra };
}

/** Supabase のログイン確認と Anthropic を、どちらも偽物に差し替える。 */
function stubNetwork(options: { session?: boolean; ai?: unknown; aiStatus?: number } = {}) {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.includes("/auth/v1/user")) return new Response("{}", { status: options.session === false ? 401 : 200 });
      return new Response(JSON.stringify(options.ai ?? aiReply([])), { status: options.aiStatus ?? 200 });
    }),
  );
  return calls;
}

const goodBody = { tripName: "四国旅行", destination: "四国", places: ["霊山寺", "児島駅"], context: ["大麻比古神社 徳島県鳴門市"] };

describe("cleanText / readBody", () => {
  it("改行・タブ・矢印を空白に直す(画面の「元 → 新」の表を壊さない)。文字以外は空", () => {
    expect(cleanText("  霊山寺\n(1番)\t ")).toBe("霊山寺 (1番)");
    expect(cleanText("東京→京都")).toBe("東京 京都");
    expect(cleanText(123)).toBe("");
  });

  it("場所を整える: 空・長すぎるもの・重複を落とし、MAX_PLACES で切って truncated を立てる。場所が無ければ null", () => {
    expect(readBody({ places: [] })).toBeNull();
    expect(readBody({ places: ["", "  ", 5] })).toBeNull();
    const body = readBody({ places: ["霊山寺", "霊山寺", "x".repeat(200), "児島駅"] });
    expect(body?.places).toEqual(["霊山寺", "児島駅"]);
    const many = readBody({ places: Array.from({ length: MAX_PLACES + 5 }, (_, i) => `場所${i}`) });
    expect(many?.places).toHaveLength(MAX_PLACES);
    expect(many?.truncated).toBe(true);
    expect(readBody({ places: ["A"] })?.truncated).toBe(false);
  });

  it("AI に渡す文章は、旅行の名前・行き先・番号つきの場所・手がかりの場所の順", () => {
    const text = buildUserMessage(readBody(goodBody)!);
    expect(text).toBe("[旅行の名前] 四国旅行\n[行き先] 四国\n[補ってほしい場所]\n1. 霊山寺\n2. 児島駅\n[ほかの場所(すでに住所が書いてある場所。どの地域を回る旅行かの手がかり)]\n- 大麻比古神社 徳島県鳴門市");
    expect(buildUserMessage({ tripName: "", destination: "", places: ["A"], context: [] })).toBe("[補ってほしい場所]\n1. A");
  });
});

describe("parseSuggestions(AI の返事を検証する)", () => {
  const ok = (to: string, from = "霊山寺") => ({ from, candidates: [{ to }], sure: true });

  it("渡した場所に対する、名前で始まる候補だけを残す。渡した順に並べる", () => {
    const text = JSON.stringify({ items: [ok("児島駅 岡山県倉敷市", "児島駅"), ok("霊山寺 徳島県鳴門市")] });
    expect(parseSuggestions(text, ASKED)).toEqual([
      { from: "霊山寺", candidates: [{ to: "霊山寺 徳島県鳴門市" }], sure: true },
      { from: "児島駅", candidates: [{ to: "児島駅 岡山県倉敷市" }], sure: true },
    ]);
  });

  it("渡していない場所・名前を言い換えた候補・元と同じ候補・長すぎる候補は捨てる。候補が残らない場所は出さない", () => {
    const text = JSON.stringify({
      items: [
        ok("別の場所 東京都", "渡していない場所"),
        ok("りょうぜんじ 徳島県鳴門市"),
        { from: "児島駅", candidates: [{ to: "児島駅" }, { to: `児島駅 ${"あ".repeat(200)}` }], sure: true },
      ],
    });
    expect(parseSuggestions(text, ASKED)).toEqual([]);
  });

  it("候補は最大3つ・重複は1つに。迷う時(sure が true でない)は false", () => {
    const candidates = ["霊山寺 徳島県鳴門市", "霊山寺 奈良県奈良市", "霊山寺 奈良県奈良市", "霊山寺 京都府京都市", "霊山寺 大分県大分市"].map((to) => ({ to }));
    const [item] = parseSuggestions(JSON.stringify({ items: [{ from: "霊山寺", candidates, sure: "yes" }] }), ASKED);
    expect(item.candidates.map((c) => c.to)).toEqual(["霊山寺 徳島県鳴門市", "霊山寺 奈良県奈良市", "霊山寺 京都府京都市"]);
    expect(item.candidates).toHaveLength(MAX_CANDIDATES);
    expect(item.sure).toBe(false);
  });

  it("候補の中の矢印・改行は取り除く(表を壊さない)", () => {
    const [item] = parseSuggestions(JSON.stringify({ items: [ok("霊山寺 徳島県\n鳴門市→大麻町")] }), ASKED);
    expect(item.candidates[0].to).toBe("霊山寺 徳島県 鳴門市 大麻町");
  });

  it("説明文やコードフェンスが付いていても、JSON の部分だけ読む。壊れた返事・形が違う返事は空", () => {
    const text = "```json\n" + JSON.stringify({ items: [ok("霊山寺 徳島県鳴門市")] }) + "\n```";
    expect(parseSuggestions(text, ASKED)).toHaveLength(1);
    expect(parseSuggestions("読み取れません", ASKED)).toEqual([]);
    expect(parseSuggestions("{壊れた", ASKED)).toEqual([]);
    expect(parseSuggestions('{"items":"x"}', ASKED)).toEqual([]);
    expect(parseSuggestions('{"items":[null,5,{"from":3}]}', ASKED)).toEqual([]);
  });
});

describe("suggestPlaces(受け口)", () => {
  it("ログイン中なら AI に聞いて、検証した提案・切れたか・使ったトークン数を返す", async () => {
    const calls = stubNetwork({ ai: aiReply([{ from: "霊山寺", candidates: [{ to: "霊山寺 徳島県鳴門市" }, { to: "霊山寺 奈良県奈良市" }], sure: false }]) });
    const reply = await suggestPlaces("POST", goodBody, "Bearer user-token");
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      suggestions: [{ from: "霊山寺", candidates: [{ to: "霊山寺 徳島県鳴門市" }, { to: "霊山寺 奈良県奈良市" }], sure: false }],
      truncated: false,
      usage: { inputTokens: 1500, outputTokens: 700 },
    });
    // ログインの確認が先、そのあとに AI。AI には、場所の名前が番号つきで渡る。
    expect(calls[0].url).toContain("/auth/v1/user");
    const ai = calls[1].body as { model: string; messages: { content: string }[]; system: string };
    expect(calls[1].url).toBe("https://api.anthropic.com/v1/messages");
    expect(ai.messages[0].content).toContain("1. 霊山寺");
    expect(ai.system).toBe(SYSTEM_PROMPT);
  });

  it("ログインしていない・トークンが違う時は、AI を呼ばない(お金をかけない)", async () => {
    const calls = stubNetwork({ session: false });
    expect((await suggestPlaces("POST", goodBody, undefined)).status).toBe(401);
    expect((await suggestPlaces("POST", goodBody, "Bearer wrong")).status).toBe(401);
    expect(calls.some((call) => call.url.includes("anthropic"))).toBe(false);
  });

  it("POST 以外・AI のキーが無い・Supabase の設定が無い・場所が無い・壊れた本文は、AI を呼ばずに断る", async () => {
    const calls = stubNetwork();
    expect((await suggestPlaces("GET", goodBody, "Bearer t")).status).toBe(405);
    expect((await suggestPlaces("POST", { places: [] }, "Bearer t")).status).toBe(400);
    expect((await suggestPlaces("POST", "{壊れた", "Bearer t")).status).toBe(400);
    vi.stubEnv("VITE_SUPABASE_URL", "");
    expect((await suggestPlaces("POST", goodBody, "Bearer t")).status).toBe(503);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect((await suggestPlaces("POST", goodBody, "Bearer t")).status).toBe(500);
    expect(calls.some((call) => call.url.includes("anthropic"))).toBe(false);
  });

  it("AI 側の失敗(支払い・制限など)は、その状態番号のまま返す。答えが長すぎて切れた・空の返事は 502", async () => {
    stubNetwork({ ai: { error: { type: "invalid_request_error", message: "Your credit balance is too low" } }, aiStatus: 400 });
    const failed = await suggestPlaces("POST", goodBody, "Bearer t");
    expect(failed.status).toBe(400);
    expect((failed.body as { error: string }).error).toContain("credit balance");

    stubNetwork({ ai: aiReply([], { stop_reason: "max_tokens" }) });
    expect((await suggestPlaces("POST", goodBody, "Bearer t")).status).toBe(502);
    stubNetwork({ ai: { content: [{ type: "thinking" }], stop_reason: "end_turn" } });
    expect((await suggestPlaces("POST", goodBody, "Bearer t")).status).toBe(502);
  });

  it("多すぎる場所は、先頭の MAX_PLACES 件だけ聞いて truncated で知らせる", async () => {
    const calls = stubNetwork();
    const places = Array.from({ length: MAX_PLACES + 20 }, (_, i) => `場所${i}`);
    const reply = await suggestPlaces("POST", { places }, "Bearer t");
    expect((reply.body as { truncated: boolean }).truncated).toBe(true);
    expect((calls[1].body as { messages: { content: string }[] }).messages[0].content).toContain(`${MAX_PLACES}. 場所${MAX_PLACES - 1}`);
    expect((calls[1].body as { messages: { content: string }[] }).messages[0].content).not.toContain(`場所${MAX_PLACES}\n`);
  });
});

describe("Vercel 版と Netlify 版は同じ", () => {
  it("中核の関数・指示文が同じ結果を返す", async () => {
    expect(VERCEL_SYSTEM_PROMPT).toBe(SYSTEM_PROMPT);
    const text = JSON.stringify({ items: [{ from: "霊山寺", candidates: [{ to: "霊山寺 徳島県鳴門市" }], sure: true }] });
    expect(vercelParseSuggestions(text, ASKED)).toEqual(parseSuggestions(text, ASKED));
    expect(vercelReadBody(goodBody)).toEqual(readBody(goodBody));
    stubNetwork({ ai: aiReply([{ from: "霊山寺", candidates: [{ to: "霊山寺 徳島県鳴門市" }], sure: true }]) });
    expect(await vercelSuggestPlaces("POST", goodBody, "Bearer t")).toEqual(await suggestPlaces("POST", goodBody, "Bearer t"));
  });

  it("入り口: Netlify は event から、Vercel は req/res から、同じ受け口を呼ぶ", async () => {
    stubNetwork({ ai: aiReply([{ from: "霊山寺", candidates: [{ to: "霊山寺 徳島県鳴門市" }], sure: true }]) });
    const netlify = await netlifyHandler({ httpMethod: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(goodBody) } as never, {} as never);
    expect(netlify).toMatchObject({ statusCode: 200, headers: { "content-type": "application/json" } });
    expect(JSON.parse((netlify as { body: string }).body).suggestions[0].from).toBe("霊山寺");

    let status = 0;
    let json: unknown;
    const res = { status: (code: number) => ({ json: (value: unknown) => ((status = code), (json = value)) }) };
    await vercelHandler({ method: "POST", headers: { authorization: "Bearer t" }, body: goodBody } as never, res as never);
    expect(status).toBe(200);
    expect(json).toEqual(JSON.parse((netlify as { body: string }).body));

    // ログインなしは Netlify でも Vercel でも 401。
    stubNetwork({ session: false });
    expect(((await netlifyHandler({ httpMethod: "POST", headers: {}, body: JSON.stringify(goodBody) } as never, {} as never)) as { statusCode: number }).statusCode).toBe(401);
  });
});
