import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADD_SCHEDULE_ITEMS,
  CREATE_TRIP,
  GET_TRIP_SCHEDULE,
  LIST_TRIPS,
  SEND_TRIP_PLAN,
  SEND_TRIP_PLAN_TOOL,
  SUPPORTED_PROTOCOL_VERSIONS,
  TOOLS,
  authRequiredResult,
  bearerToken,
  handleMcpBody,
  handleMcpMessage,
  handler as netlifyHandler,
  publicBaseUrl,
  resetJwksCache,
  resourceMetadataUrl,
  resourceUrl,
  stableId,
  verifyAccessToken,
} from "../functions/mcp";
import vercelHandler, {
  TOOLS as VERCEL_TOOLS,
  handleMcpBody as vercelHandleMcpBody,
  handleMcpMessage as vercelHandleMcpMessage,
  resetJwksCache as vercelResetJwksCache,
} from "../../api/mcp";
import { handler as netlifyPrmHandler, protectedResourceMetadata as netlifyPrm } from "../functions/oauthProtectedResource";
import vercelPrmHandler, { protectedResourceMetadata } from "../../api/oauthProtectedResource";
import { NETLIFY_TAILS, netlifySource } from "../../scripts/gen-netlify-functions.mjs";

const SUPA = "https://example.supabase.co";
const ANON = "anon-key";
const USER = "11111111-2222-4333-8444-555555555555";
const TRIP = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BASE = "https://life-hub-dashboard.vercel.app";

// ---------------------------------------------------------------- 署名つきトークンと、偽の Supabase

interface Signer {
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
  alg: "ES256" | "RS256";
}

function makeSigner(alg: "ES256" | "RS256" = "ES256", kid = "key-1"): Signer {
  const pair =
    alg === "ES256" ? generateKeyPairSync("ec", { namedCurve: "P-256" }) : generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey: pair.privateKey, jwk: { ...pair.publicKey.export({ format: "jwk" }), kid, alg, use: "sig" }, alg };
}

const b64 = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

function makeToken(signer: Signer, claims: Record<string, unknown> = {}, headerOverrides: Record<string, unknown> = {}): string {
  const header = { alg: signer.alg, typ: "JWT", kid: signer.jwk.kid, ...headerOverrides };
  const payload = {
    iss: `${SUPA}/auth/v1`,
    sub: USER,
    role: "authenticated",
    client_id: "chatgpt-client",
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  };
  const data = `${b64(header)}.${b64(payload)}`;
  const signature =
    signer.alg === "ES256"
      ? sign("sha256", Buffer.from(data), { key: signer.privateKey, dsaEncoding: "ieee-p1363" })
      : sign("sha256", Buffer.from(data), signer.privateKey);
  return `${data}.${signature.toString("base64url")}`;
}

interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Supabase の代わり。鍵(JWKS)と、旅行・日程の表(行を持つ)と、受信箱の関数を、メモリの中で動かす。 */
class FakeSupabase {
  calls: Recorded[] = [];
  jwksFetches = 0;
  trips: Record<string, unknown>[] = [];
  schedule: Record<string, unknown>[] = [];
  /** 次のREST呼び出しを、この状態で失敗させる(ステータス)。 */
  failNext?: number;
  rpcReply: { status: number; body: unknown } = { status: 200, body: { ok: true, received: 1 } };

  constructor(public signer: Signer) {}

  install() {
    vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => this.handle(url, init)));
    vi.stubEnv("VITE_SUPABASE_URL", SUPA);
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", ANON);
  }

  private reply(status: number, body: unknown) {
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
  }

  private handle(url: string, init: RequestInit) {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    if (url === `${SUPA}/auth/v1/.well-known/jwks.json`) {
      this.jwksFetches++;
      return this.reply(200, { keys: [this.signer.jwk] });
    }
    this.calls.push({ method, url, headers, body });
    if (url === `${SUPA}/rest/v1/rpc/receive_chatgpt_trip`) return this.reply(this.rpcReply.status, this.rpcReply.body);

    const rest = url.slice(`${SUPA}/rest/v1/`.length);
    const [table, query = ""] = rest.split("?");
    const params = new URLSearchParams(query);
    if (this.failNext) {
      const status = this.failNext;
      this.failNext = undefined;
      return this.reply(status, { message: "failed" });
    }
    const store = table === "trips" ? this.trips : this.schedule;
    if (method === "GET") {
      let rows = store.filter((row) => (params.get("deleted_at") === "is.null" ? row.deleted_at == null : true));
      const id = params.get("id");
      if (id) rows = rows.filter((row) => row.id === id.replace("eq.", ""));
      const tripId = params.get("trip_id");
      if (tripId) rows = rows.filter((row) => row.trip_id === tripId.replace("eq.", ""));
      return this.reply(200, rows);
    }
    if (method === "POST") {
      const incoming = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
      const inserted: Record<string, unknown>[] = [];
      for (const row of incoming) {
        if (store.some((existing) => existing.id === row.id)) continue; // ignore-duplicates
        store.push({ deleted_at: null, ...row });
        inserted.push(row);
      }
      return this.reply(201, inserted);
    }
    return this.reply(405, null);
  }

  token(claims: Record<string, unknown> = {}) {
    return makeToken(this.signer, claims);
  }

  seedTrip(overrides: Record<string, unknown> = {}) {
    const trip = { id: TRIP, user_id: USER, name: "四国旅行", destination: "高松", start_date: "2026-12-27", end_date: "2027-01-02", status: "planning", deleted_at: null, ...overrides };
    this.trips.push(trip);
    return trip;
  }

  /** 書き込み・読み出しとして使われた HTTP メソッドの一覧(削除・更新が使われていないことを確かめる用)。 */
  get restMethods() {
    return new Set(this.calls.filter((c) => c.url.includes("/rest/v1/") && !c.url.includes("/rpc/")).map((c) => c.method));
  }
}

let supa: FakeSupabase;

beforeEach(() => {
  resetJwksCache();
  vercelResetJwksCache();
  supa = new FakeSupabase(makeSigner());
  supa.install();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function rpc(method: string, params?: unknown, id: number | string | null = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

async function callAs(token: string | undefined, name: string, args: unknown) {
  const reply = (await handleMcpMessage(rpc("tools/call", { name, arguments: args }), { accessToken: token, baseUrl: BASE })) as {
    result: { isError: boolean; content: { text: string }[]; structuredContent: Record<string, unknown>; _meta?: Record<string, string[]> };
  };
  return reply.result;
}

const goodItem = (over: Record<string, unknown> = {}) => ({ date: "2026-12-27", startTime: "9:00", title: "羽田→高松", type: "transport", ...over });

// ---------------------------------------------------------------- 基本(initialize / ping / 通知)

describe("initialize / ping / 通知", () => {
  it("クライアントが挙げた版が対応済みなら、そのまま返す。無ければいちばん新しい版を返す", async () => {
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      expect(await handleMcpMessage(rpc("initialize", { protocolVersion: version }))).toMatchObject({ result: { protocolVersion: version } });
    }
    expect(await handleMcpMessage(rpc("initialize", { protocolVersion: "1999-01-01" }))).toMatchObject({
      result: { protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0] },
    });
    expect(await handleMcpMessage(rpc("initialize"))).toMatchObject({ result: { protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0] } });
  });

  it("ツールだけを持つサーバーだと名乗る(資源・プロンプトは持たない)", async () => {
    const reply = (await handleMcpMessage(rpc("initialize", { protocolVersion: "2025-06-18" }, "abc"))) as {
      id: string;
      result: { capabilities: Record<string, unknown>; serverInfo: { name: string } };
    };
    expect(reply.id).toBe("abc");
    expect(Object.keys(reply.result.capabilities)).toEqual(["tools"]);
    expect(reply.result.serverInfo.name).toBe("life-hub-trip-inbox");
  });

  it("ping には空で答える。通知(id なし)や相手からの返事には返事をしない", async () => {
    expect(await handleMcpMessage(rpc("ping"))).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/whatever" })).toBeNull();
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 5, result: {} })).toBeNull();
  });

  it("壊れたメッセージ・知らない方法には、JSON-RPC のエラーで返す", async () => {
    for (const bad of [null, "text", 42, [], { id: 1, method: "ping" }, { jsonrpc: "1.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 1 }]) {
      expect(await handleMcpMessage(bad), JSON.stringify(bad)).toMatchObject({ error: { code: -32600 } });
    }
    expect(await handleMcpMessage(rpc("resources/list"))).toMatchObject({ id: 1, error: { code: -32601 } });
    expect(await handleMcpMessage(rpc("tools/call", { name: "delete_everything", arguments: {} }))).toMatchObject({ error: { code: -32602 } });
  });
});

// ---------------------------------------------------------------- tools/list

describe("tools/list", () => {
  it("5つのツールを出す。ログインが要るものには oauth2、送信コード版には noauth を付ける", async () => {
    const reply = (await handleMcpMessage(rpc("tools/list"))) as { result: { tools: typeof TOOLS } };
    const byName = Object.fromEntries(reply.result.tools.map((tool) => [tool.name, tool]));
    expect(Object.keys(byName).sort()).toEqual([ADD_SCHEDULE_ITEMS, CREATE_TRIP, GET_TRIP_SCHEDULE, LIST_TRIPS, SEND_TRIP_PLAN].sort());
    expect(byName[SEND_TRIP_PLAN].securitySchemes).toEqual([{ type: "noauth" }]);
    for (const name of [LIST_TRIPS, CREATE_TRIP, ADD_SCHEDULE_ITEMS, GET_TRIP_SCHEDULE]) {
      expect(byName[name].securitySchemes[0].type, name).toBe("oauth2");
      // ChatGPT が読む場所(_meta)にも同じものを置く。
      expect(byName[name]._meta.securitySchemes, name).toEqual(byName[name].securitySchemes);
    }
  });

  it("消す・上書きする種類のツールは無い。読むだけのものには readOnlyHint を付ける", () => {
    for (const tool of TOOLS) expect(tool.annotations.destructiveHint, tool.name).toBe(false);
    expect(TOOLS.find((t) => t.name === LIST_TRIPS)?.annotations.readOnlyHint).toBe(true);
    expect(TOOLS.find((t) => t.name === GET_TRIP_SCHEDULE)?.annotations.readOnlyHint).toBe(true);
    expect(TOOLS.find((t) => t.name === CREATE_TRIP)?.annotations.readOnlyHint).toBe(false);
    expect(TOOLS.map((t) => t.name).some((name) => /delete|remove|update/.test(name))).toBe(false);
    // 金額の項目は、どのツールも持たない(GPTの見積もりが旅行の費用に積まれないように)。
    expect(JSON.stringify(TOOLS.map((t) => t.inputSchema))).not.toMatch(/amount|price/);
  });

  it("送信コード版の入力定義が、GPT用の接続定義(openapi.json)と同じ", () => {
    const spec = JSON.parse(readFileSync(new URL("../../public/chatgpt/openapi.json", import.meta.url), "utf8"));
    const schema = spec.paths["/api/receiveTripPlan"].post.requestBody.content["application/json"].schema;
    expect(SEND_TRIP_PLAN_TOOL.inputSchema).toEqual(schema);
  });

  it("日程の項目の定義が、送信コード版と、日程を足すツールで同じ", () => {
    const add = TOOLS.find((t) => t.name === ADD_SCHEDULE_ITEMS)!.inputSchema as { properties: { items: { items: unknown } } };
    const send = SEND_TRIP_PLAN_TOOL.inputSchema as { properties: { items: { items: unknown } } };
    expect(add.properties.items.items).toEqual(send.properties.items.items);
  });
});

// ---------------------------------------------------------------- ログインの確認

describe("verifyAccessToken", () => {
  it("正しい署名・期限・発行元・OAuth由来のトークンを通す", async () => {
    expect(await verifyAccessToken(supa.token())).toEqual({ ok: true, userId: USER, clientId: "chatgpt-client" });
  });

  it("RS256 の署名も確かめられる", async () => {
    const rsa = new FakeSupabase(makeSigner("RS256", "rsa-key"));
    rsa.install();
    expect(await verifyAccessToken(rsa.token())).toMatchObject({ ok: true, userId: USER });
  });

  it("トークンが無い・形が違う・鍵が違う・書き換えられている時は通さない", async () => {
    expect(await verifyAccessToken(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(await verifyAccessToken("not-a-jwt")).toEqual({ ok: false, reason: "invalid" });
    // 別の鍵で署名したもの。
    expect(await verifyAccessToken(makeToken(makeSigner("ES256", "key-1")))).toEqual({ ok: false, reason: "invalid" });
    // 中身(ユーザー)だけを別の人に書き換えたもの。
    const [h, , s] = supa.token().split(".");
    const forged = `${h}.${b64({ iss: `${SUPA}/auth/v1`, sub: "99999999-2222-4333-8444-555555555555", role: "authenticated", client_id: "x", exp: 9999999999 })}.${s}`;
    expect(await verifyAccessToken(forged)).toEqual({ ok: false, reason: "invalid" });
    // alg: none や、対応しない alg。
    expect(await verifyAccessToken(`${b64({ alg: "none" })}.${b64({ sub: USER })}.`)).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyAccessToken(makeToken(supa.signer, {}, { alg: "HS256" }))).toEqual({ ok: false, reason: "invalid" });
  });

  it("期限切れ・発行元違い・ログイン済みでない・OAuth由来でない(普通のログイン)は通さない", async () => {
    expect(await verifyAccessToken(supa.token({ exp: Math.floor(Date.now() / 1000) - 600 }))).toEqual({ ok: false, reason: "expired" });
    expect(await verifyAccessToken(supa.token({ iss: "https://evil.example/auth/v1" }))).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyAccessToken(supa.token({ role: "anon" }))).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyAccessToken(supa.token({ sub: "not-a-uuid" }))).toEqual({ ok: false, reason: "invalid" });
    // client_id が無い = OAuth を通っていない、アプリ自身のログインのトークン。
    expect(await verifyAccessToken(supa.token({ client_id: undefined }))).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyAccessToken(supa.token({ nbf: Math.floor(Date.now() / 1000) + 3600 }))).toEqual({ ok: false, reason: "invalid" });
  });

  it("鍵は控えて使い回し、知らない鍵IDが来た時だけ1回取り直す", async () => {
    await verifyAccessToken(supa.token());
    await verifyAccessToken(supa.token());
    expect(supa.jwksFetches).toBe(1);
    expect(await verifyAccessToken(makeToken(supa.signer, {}, { kid: "rotated" }))).toEqual({ ok: false, reason: "invalid" });
    expect(supa.jwksFetches).toBe(2);
  });

  it("接続設定が無い・鍵を取れない時は config", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    expect(await verifyAccessToken(supa.token())).toEqual({ ok: false, reason: "config" });
    vi.stubEnv("VITE_SUPABASE_URL", SUPA);
    resetJwksCache();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network");
    }));
    expect(await verifyAccessToken(supa.token())).toEqual({ ok: false, reason: "config" });
  });
});

describe("ログインが要る時の返事", () => {
  it("トークンが無ければ、ChatGPT がログイン画面を出すための印(mcp/www_authenticate)を付けて返す", async () => {
    const result = await callAs(undefined, LIST_TRIPS, {});
    expect(result.isError).toBe(true);
    const challenge = result._meta?.["mcp/www_authenticate"]?.[0] ?? "";
    expect(challenge).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/api/mcp"`);
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain("error_description=");
    // Supabase には、問い合わせていない(未ログインの人のために、何も読まない)。
    expect(supa.calls).toEqual([]);
  });

  it("期限切れ・不正も同じ形(理由だけ違う)", async () => {
    const expired = await callAs(supa.token({ exp: Math.floor(Date.now() / 1000) - 600 }), LIST_TRIPS, {});
    expect(expired._meta?.["mcp/www_authenticate"]?.[0]).toContain("expired");
    const bad = await callAs("garbage", LIST_TRIPS, {});
    expect(bad._meta?.["mcp/www_authenticate"]?.[0]).toContain("invalid");
  });

  it("説明文に引用符が混ざらない(ヘッダーが壊れない)", () => {
    for (const reason of ["missing", "invalid", "expired"] as const) {
      const challenge = (authRequiredResult(BASE, reason)._meta as Record<string, string[]>)["mcp/www_authenticate"][0];
      const description = challenge.match(/error_description="([^"]*)"$/)?.[1];
      expect(description, reason).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it("送信コード版は、ログインが無くても動く", async () => {
    const result = await callAs(undefined, SEND_TRIP_PLAN, { code: "LH-ABCD-EFGH-JKLM-NPQR-STUV", items: [{ date: "2026-12-27", title: "x" }] });
    expect(result.isError).toBe(false);
    expect(supa.calls.map((c) => c.url)).toEqual([`${SUPA}/rest/v1/rpc/receive_chatgpt_trip`]);
  });
});

// ---------------------------------------------------------------- 旅行・日程のツール

describe("list_trips", () => {
  it("その人の旅行を返す。消された旅行は出さない。Supabase へは、その人のトークンで問い合わせる", async () => {
    supa.seedTrip();
    supa.seedTrip({ id: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "消した旅行", deleted_at: "2026-10-01T00:00:00Z" });
    const token = supa.token();
    const result = await callAs(token, LIST_TRIPS, {});
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("四国旅行");
    expect(result.content[0].text).not.toContain("消した旅行");
    expect(result.structuredContent.trips).toHaveLength(1);

    const call = supa.calls[0];
    expect(call.headers.authorization).toBe(`Bearer ${token}`);
    expect(call.headers.apikey).toBe(ANON);
    expect(call.url).toContain("deleted_at=is.null");
  });

  it("旅行が無ければ、作れることを伝える", async () => {
    const result = await callAs(supa.token(), LIST_TRIPS, {});
    expect(result.structuredContent).toMatchObject({ ok: true, trips: [] });
    expect(result.content[0].text).toContain("create_trip");
  });
});

describe("create_trip", () => {
  const args = { name: "四国旅行", startDate: "2026-12-27", endDate: "2027-01-02", destination: "高松" };

  it("旅行を1つ作る。アプリの同期が拾える形の行(device_id・時刻・状態つき)にする", async () => {
    const result = await callAs(supa.token(), CREATE_TRIP, args);
    expect(result.isError).toBe(false);
    expect(supa.trips).toHaveLength(1);
    expect(supa.trips[0]).toMatchObject({
      user_id: USER,
      device_id: "chatgpt",
      name: "四国旅行",
      destination: "高松",
      start_date: "2026-12-27",
      end_date: "2027-01-02",
      status: "planning",
    });
    expect(supa.trips[0].id).toBe(result.structuredContent.tripId);
    expect(typeof supa.trips[0].created_at).toBe("string");
    expect(typeof supa.trips[0].updated_at).toBe("string");
    const post = supa.calls.find((c) => c.method === "POST")!;
    expect(post.headers.prefer).toContain("resolution=ignore-duplicates");
  });

  it("行き先を省くと、名前が入る。日付の書き方の揺れは直す", async () => {
    await callAs(supa.token(), CREATE_TRIP, { name: "京都", startDate: "2026-9-3", endDate: "2026/09/05" });
    expect(supa.trips[0]).toMatchObject({ destination: "京都", start_date: "2026-09-03", end_date: "2026-09-05" });
  });

  it("同じ名前・期間をもう一度作ろうとしても二重にならず、あるものを返す", async () => {
    const first = await callAs(supa.token(), CREATE_TRIP, args);
    const second = await callAs(supa.token(), CREATE_TRIP, args);
    expect(supa.trips).toHaveLength(1);
    expect(second.isError).toBe(false);
    expect(second.structuredContent).toMatchObject({ tripId: first.structuredContent.tripId, created: false });
    expect(second.content[0].text).toContain("すでにあります");
  });

  it("以前に消した旅行と同じ名前・期間は、作り直さず、別の名前を案内する", async () => {
    const first = await callAs(supa.token(), CREATE_TRIP, args);
    supa.trips[0].deleted_at = "2026-10-02T00:00:00Z";
    const again = await callAs(supa.token(), CREATE_TRIP, args);
    expect(again.isError).toBe(true);
    expect(again.content[0].text).toContain("別の名前");
    expect(supa.trips).toHaveLength(1);
    expect(first.isError).toBe(false);
  });

  it("名前・日付が駄目なら、Supabase に書かずに理由を返す", async () => {
    const bad = [
      {},
      { name: "x" },
      { name: "x", startDate: "2026-12-27", endDate: "2026-12-26" },
      { name: "x", startDate: "2026-01-01", endDate: "2026-06-01" },
      { name: "x", startDate: "2026-02-30", endDate: "2026-03-01" },
      { name: "  ", startDate: "2026-12-27", endDate: "2026-12-28" },
    ];
    for (const input of bad) {
      const result = await callAs(supa.token(), CREATE_TRIP, input);
      expect(result.isError, JSON.stringify(input)).toBe(true);
    }
    expect(supa.calls).toEqual([]);
  });
});

describe("add_schedule_items", () => {
  beforeEach(() => {
    supa.seedTrip();
  });

  it("日程の行を足す。アプリの同期が拾える形で、金額・到着地は書かない", async () => {
    const result = await callAs(supa.token(), ADD_SCHEDULE_ITEMS, {
      tripId: TRIP,
      items: [goodItem({ endTime: "11:10", location: "羽田空港", endLocation: "高松空港", amount: 9000, memo: "座席 12A" }), { date: "2026-12-28", title: "屋島観光", type: "sightseeing" }],
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ added: 2, alreadyThere: 0, skipped: 0, outsidePeriod: 0 });
    expect(supa.schedule).toHaveLength(2);
    expect(supa.schedule[0]).toMatchObject({
      user_id: USER,
      device_id: "chatgpt",
      trip_id: TRIP,
      date: "2026-12-27",
      start_time: "09:00",
      end_time: "11:10",
      title: "羽田→高松",
      location: "羽田空港",
      memo: "座席 12A",
      type: "transport",
    });
    expect(supa.schedule[1]).toMatchObject({ start_time: null, end_time: null, location: null, type: "sightseeing" });
    const written = JSON.stringify(supa.calls.filter((c) => c.method === "POST").map((c) => c.body));
    expect(written).not.toContain("9000");
    expect(written).not.toContain("高松空港");
    expect(written).not.toContain("end_location");
  });

  it("同じ旅程をもう一度送っても二重にならず、あるものは上書きもしない", async () => {
    await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [goodItem()] });
    // 本人がアプリで場所を書き足した、という状況。
    supa.schedule[0].location = "本人が書いた場所";
    const again = await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [goodItem({ location: "ChatGPTの書いた場所" })] });
    expect(again.structuredContent).toMatchObject({ added: 0, alreadyThere: 1 });
    expect(supa.schedule).toHaveLength(1);
    expect(supa.schedule[0].location).toBe("本人が書いた場所");
    // 書き込みは「重複は無視」の指定で出している(上書きしない)。
    for (const call of supa.calls.filter((c) => c.method === "POST")) expect(call.headers.prefer).toContain("resolution=ignore-duplicates");
  });

  it("本人が消した予定は、同じものを送っても戻らない", async () => {
    await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [goodItem()] });
    supa.schedule[0].deleted_at = "2026-10-03T00:00:00Z";
    const again = await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [goodItem()] });
    expect(again.structuredContent).toMatchObject({ added: 0, alreadyThere: 1 });
    expect(supa.schedule).toHaveLength(1);
    expect(supa.schedule[0].deleted_at).not.toBeNull();
  });

  it("旅行の期間の外の日付は入れず、何件かを伝える。全部が外なら、何も書かずに理由を返す", async () => {
    const mixed = await callAs(supa.token(), ADD_SCHEDULE_ITEMS, {
      tripId: TRIP,
      items: [goodItem(), { date: "2027-02-01", title: "期間の外" }],
    });
    expect(mixed.structuredContent).toMatchObject({ added: 1, outsidePeriod: 1 });
    expect(mixed.content[0].text).toContain("期間の外だった1件");
    expect(supa.schedule.map((row) => row.title)).toEqual(["羽田→高松"]);

    supa.calls.length = 0;
    const outside = await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [{ date: "2027-02-01", title: "外" }] });
    expect(outside.isError).toBe(true);
    expect(supa.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("日付か題名が読めない予定は除いて数える。全部駄目なら理由を返す", async () => {
    const some = await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [goodItem(), { title: "日付なし" }, "文字列"] });
    expect(some.structuredContent).toMatchObject({ added: 1, skipped: 2 });
    const none = await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [{ title: "日付なし" }] });
    expect(none.isError).toBe(true);
  });

  it("旅行のIDが違う・無い・他の人の(見えない)旅行の時は、書かずに案内する", async () => {
    for (const tripId of [undefined, "abc", "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee"]) {
      supa.calls.length = 0;
      const result = await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId, items: [goodItem()] });
      expect(result.isError, String(tripId)).toBe(true);
      expect(result.content[0].text).toMatch(/list_trips/);
      expect(supa.calls.some((c) => c.method === "POST")).toBe(false);
    }
  });

  it("消された旅行には足せない。空・多すぎる件数は、Supabase を呼ばずに断る", async () => {
    supa.trips[0].deleted_at = "2026-10-02T00:00:00Z";
    expect((await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [goodItem()] })).isError).toBe(true);
    supa.calls.length = 0;
    expect((await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [] })).isError).toBe(true);
    const many = Array.from({ length: 201 }, (_, i) => goodItem({ title: `散策${i}` }));
    const tooMany = await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: many });
    expect(tooMany.isError).toBe(true);
    expect(tooMany.content[0].text).toContain("200件");
    expect(supa.calls).toEqual([]);
  });

  it("削除・更新の要求は、1度も出さない(読む・足すだけ)", async () => {
    await callAs(supa.token(), CREATE_TRIP, { name: "x", startDate: "2026-12-27", endDate: "2026-12-28" });
    await callAs(supa.token(), LIST_TRIPS, {});
    await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [goodItem()] });
    await callAs(supa.token(), GET_TRIP_SCHEDULE, { tripId: TRIP });
    expect([...supa.restMethods].sort()).toEqual(["GET", "POST"]);
  });

  it("Supabase が 401/403 なら、ログインし直しの案内。それ以外の失敗は、ふつうの失敗", async () => {
    supa.failNext = 401;
    const unauthorized = await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [goodItem()] });
    expect(unauthorized._meta?.["mcp/www_authenticate"]).toBeDefined();
    supa.failNext = 500;
    const failed = await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [goodItem()] });
    expect(failed.isError).toBe(true);
    expect(failed._meta).toBeUndefined();
  });
});

describe("get_trip_schedule", () => {
  it("日程を返す(その旅行の、消されていないものだけ)", async () => {
    supa.seedTrip();
    await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [goodItem(), goodItem({ title: "昼食", startTime: "12:00", type: "meal" })] });
    supa.schedule[1].deleted_at = "2026-10-03T00:00:00Z";
    const result = await callAs(supa.token(), GET_TRIP_SCHEDULE, { tripId: TRIP });
    expect(result.isError).toBe(false);
    expect(result.structuredContent.items).toHaveLength(1);
    expect(result.content[0].text).toContain("羽田→高松");
    expect(result.content[0].text).not.toContain("昼食");
  });

  it("空の旅行・見つからない旅行", async () => {
    supa.seedTrip();
    expect((await callAs(supa.token(), GET_TRIP_SCHEDULE, { tripId: TRIP })).content[0].text).toContain("まだ空");
    expect((await callAs(supa.token(), GET_TRIP_SCHEDULE, { tripId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" })).isError).toBe(true);
  });
});

describe("stableId", () => {
  it("同じ内容は同じID、違う内容は違うID。UUID v5 の形", () => {
    expect(stableId("a|b")).toBe(stableId("a|b"));
    expect(stableId("a|b")).not.toBe(stableId("a|c"));
    expect(stableId("x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("別の人・別の旅行・別の時刻の同じ題名は、別のID", async () => {
    supa.seedTrip();
    await callAs(supa.token(), ADD_SCHEDULE_ITEMS, { tripId: TRIP, items: [goodItem(), goodItem({ startTime: "10:00" }), goodItem({ date: "2026-12-28" })] });
    expect(new Set(supa.schedule.map((row) => row.id)).size).toBe(3);
  });
});

describe("そのほかの小さな部品", () => {
  it("Authorization ヘッダーから Bearer トークンだけを取り出す", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("bearer  abc ")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
    expect(bearerToken(["Bearer x"])).toBeUndefined();
  });

  it("公開URLと、OAuth の resource・メタデータの場所", () => {
    expect(publicBaseUrl({})).toBe("https://life-hub-dashboard.vercel.app");
    expect(publicBaseUrl({ PUBLIC_BASE_URL: "https://example.com///" })).toBe("https://example.com");
    expect(resourceUrl(BASE)).toBe(`${BASE}/api/mcp`);
    expect(resourceMetadataUrl(BASE)).toBe(`${BASE}/.well-known/oauth-protected-resource/api/mcp`);
  });
});

describe("handleMcpBody", () => {
  it("配列でも処理し、返事が要るものだけ返す。全部が通知なら返事なし", async () => {
    const mixed = await handleMcpBody([rpc("ping", undefined, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("tools/list", undefined, 2)]);
    expect(mixed).toHaveLength(2);
    expect(await handleMcpBody([{ jsonrpc: "2.0", method: "notifications/initialized" }])).toBeNull();
    expect(await handleMcpBody([])).toMatchObject({ error: { code: -32600 } });
  });
});

// ---------------------------------------------------------------- OAuth のメタデータ

describe("保護されたリソースのメタデータ", () => {
  it("resource は MCP の URL(ChatGPT が接続時に送る値と一字一句同じ)。ログインは Supabase", () => {
    expect(protectedResourceMetadata({ VITE_SUPABASE_URL: SUPA })).toEqual({
      resource: `${BASE}/api/mcp`,
      authorization_servers: [`${SUPA}/auth/v1`],
      scopes_supported: ["openid", "profile", "email"],
      bearer_methods_supported: ["header"],
      resource_name: "LIFE HUB 旅行プランナー",
    });
    expect(protectedResourceMetadata({})).toBeNull();
  });

  it("401 のときにツールが案内する場所と、実際に配る場所が合っている", () => {
    expect(resourceMetadataUrl(BASE)).toBe(`${BASE}/.well-known/oauth-protected-resource/api/mcp`);
    const rewrites = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")).rewrites as { source: string; destination: string }[];
    const sources = rewrites.map((r) => r.source);
    expect(sources).toContain("/.well-known/oauth-protected-resource/api/mcp");
    expect(sources).toContain("/.well-known/oauth-protected-resource");
    // 画面用の「何でも index.html へ」より前に置く(後だと、メタデータが画面に飲まれる)。
    const catchAll = sources.findIndex((source) => source.startsWith("/((?!"));
    expect(sources.indexOf("/.well-known/oauth-protected-resource/api/mcp")).toBeLessThan(catchAll);
    expect(sources.indexOf("/.well-known/oauth-protected-resource")).toBeLessThan(catchAll);
    const redirects = readFileSync(new URL("../../public/_redirects", import.meta.url), "utf8");
    // Netlify も、「何でも index.html へ」(行頭が /* の行)より前に置く。
    const lines = redirects.split("\n").map((line) => line.trim());
    const wellKnown = lines.findIndex((line) => line.startsWith("/.well-known/oauth-protected-resource/api/mcp"));
    const wellKnownBase = lines.findIndex((line) => line.startsWith("/.well-known/oauth-protected-resource "));
    const everything = lines.findIndex((line) => line.startsWith("/*"));
    expect(wellKnown).toBeGreaterThanOrEqual(0);
    expect(wellKnownBase).toBeGreaterThanOrEqual(0);
    expect(wellKnown).toBeLessThan(everything);
    expect(wellKnownBase).toBeLessThan(everything);
  });
});

// ---------------------------------------------------------------- Netlify版とVercel版

describe("Netlify版とVercel版のずれ", () => {
  it("同じメッセージから同じ返事を作る(ログイン付きも)", async () => {
    supa.seedTrip();
    const ctx = { accessToken: supa.token(), baseUrl: BASE };
    const messages: unknown[] = [
      rpc("initialize", { protocolVersion: "2025-03-26" }),
      rpc("ping"),
      rpc("tools/list"),
      rpc("tools/call", { name: LIST_TRIPS, arguments: {} }),
      rpc("tools/call", { name: GET_TRIP_SCHEDULE, arguments: { tripId: TRIP } }),
      rpc("tools/call", { name: SEND_TRIP_PLAN, arguments: { code: "" } }),
      rpc("tools/call", { name: "nope" }),
      rpc("resources/list"),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      null,
    ];
    for (const message of messages) {
      expect(await vercelHandleMcpMessage(message, ctx), JSON.stringify(message)).toEqual(await handleMcpMessage(message, ctx));
    }
    const anonymous = { baseUrl: BASE };
    expect(await vercelHandleMcpMessage(rpc("tools/call", { name: LIST_TRIPS }), anonymous)).toEqual(
      await handleMcpMessage(rpc("tools/call", { name: LIST_TRIPS }), anonymous),
    );
    const batch = [rpc("ping", undefined, 1), rpc("tools/list", undefined, 2)];
    expect(await vercelHandleMcpBody(batch, ctx)).toEqual(await handleMcpBody(batch, ctx));
    expect(VERCEL_TOOLS).toEqual(TOOLS);
    expect(protectedResourceMetadata({ VITE_SUPABASE_URL: SUPA })).toEqual(netlifyPrm({ VITE_SUPABASE_URL: SUPA }));
  });

  it("Netlify版のファイルが、api/ のファイルから作り直した結果と一致している(手で直すと、ここで落ちる)", () => {
    for (const name of Object.keys(NETLIFY_TAILS)) {
      const api = readFileSync(new URL(`../../api/${name}.ts`, import.meta.url), "utf8");
      const netlify = readFileSync(new URL(`../functions/${name}.ts`, import.meta.url), "utf8");
      expect(netlify, `netlify/functions/${name}.ts は node scripts/gen-netlify-functions.mjs で作り直す`).toBe(netlifySource(api, name));
    }
  });
});

// ---------------------------------------------------------------- HTTP の入り口

describe("受け口(handler)", () => {
  type Reply = { status: number; json?: unknown; headers: Record<string, string> };

  async function callVercel(method: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const reply: Reply = { status: 0, headers: {} };
    const res = {
      setHeader(name: string, value: string) {
        reply.headers[name.toLowerCase()] = value;
      },
      status(code: number) {
        reply.status = code;
        return res;
      },
      json(value: unknown) {
        reply.json = value;
        return res;
      },
      end() {
        return res;
      },
    };
    await vercelHandler({ method, body, headers } as never, res as never);
    return reply;
  }

  async function callNetlify(method: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const result = (await netlifyHandler(
      { httpMethod: method, body: typeof body === "string" ? body : JSON.stringify(body), headers } as never,
      {} as never,
    )) as { statusCode: number; body?: string; headers?: Record<string, string> };
    return {
      status: result.statusCode,
      json: result.body ? JSON.parse(result.body) : undefined,
      headers: Object.fromEntries(Object.entries(result.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    };
  }

  for (const [name, send] of [["Vercel版", callVercel], ["Netlify版", callNetlify]] as const) {
    describe(name, () => {
      it("initialize には JSON で答える。通知には 202(本文なし)", async () => {
        const reply = await send("POST", rpc("initialize", { protocolVersion: "2025-06-18" }));
        expect(reply.status).toBe(200);
        expect(reply.json).toMatchObject({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "life-hub-trip-inbox" } } });
        const note = await send("POST", { jsonrpc: "2.0", method: "notifications/initialized" });
        expect(note.status).toBe(202);
        expect(note.json).toBeUndefined();
      });

      it("Authorization ヘッダーのトークンで、その人の旅行を読む。ヘッダーが無ければ、ログインを求める", async () => {
        supa.seedTrip();
        const request = rpc("tools/call", { name: LIST_TRIPS, arguments: {} });
        const loggedIn = await send("POST", request, { authorization: `Bearer ${supa.token()}` });
        expect(loggedIn.status).toBe(200);
        expect(loggedIn.json).toMatchObject({ result: { isError: false, structuredContent: { trips: [{ name: "四国旅行" }] } } });

        const anonymous = await send("POST", request);
        expect(anonymous.status).toBe(200);
        expect(anonymous.json).toMatchObject({ result: { isError: true, _meta: { "mcp/www_authenticate": [expect.stringContaining("resource_metadata=")] } } });
      });

      it("GET などは 405(通知の待ち受けは持たない)。壊れたJSONは 400", async () => {
        const get = await send("GET", null);
        expect(get.status).toBe(405);
        expect(get.headers.allow).toBe("POST");
        const broken = await send("POST", "{not json");
        expect(broken.status).toBe(400);
        expect(broken.json).toMatchObject({ error: { code: -32700 } });
      });
    });
  }

  it("メタデータの入り口: JSON を返し、GET と HEAD だけ受ける。設定が無ければ 503", async () => {
    const vercelSend = async (method: string): Promise<Reply> => {
      const reply: Reply = { status: 0, headers: {} };
      const res = {
        setHeader: (k: string, v: string) => void (reply.headers[k.toLowerCase()] = v),
        status: (code: number) => ((reply.status = code), res),
        json: (value: unknown) => ((reply.json = value), res),
      };
      await vercelPrmHandler({ method } as never, res as never);
      return reply;
    };
    const netlifySend = async (method: string): Promise<Reply> => {
      const result = (await netlifyPrmHandler({ httpMethod: method } as never, {} as never)) as { statusCode: number; body?: string; headers?: Record<string, string> };
      return { status: result.statusCode, json: result.body ? JSON.parse(result.body) : undefined, headers: result.headers ?? {} };
    };
    for (const [name, send] of [["Vercel", vercelSend], ["Netlify", netlifySend]] as const) {
      const ok = await send("GET");
      expect(ok.status, name).toBe(200);
      expect(ok.json, name).toMatchObject({ resource: `${BASE}/api/mcp`, authorization_servers: [`${SUPA}/auth/v1`] });
      expect((await send("POST")).status, name).toBe(405);
      vi.stubEnv("VITE_SUPABASE_URL", "");
      expect((await send("GET")).status, name).toBe(503);
      vi.stubEnv("VITE_SUPABASE_URL", SUPA);
    }
  });
});

// ---------------------------------------------------------------- 本番で落ちる書き方の見張り

/**
 * サーバー関数の相対 import は、拡張子 .js を付ける。package.json が type: module なので、
 * 拡張子の無い相対 import は Node の ESM で読み込めず、Vercel 上で関数ごと落ちる
 * (FUNCTION_INVOCATION_FAILED)。手元のテストや型チェックは通ってしまうので、本番に出して初めて
 * 気付く(2026-10-07 に api/mcp.ts で実際に落ちた)。ここで先に止める。
 * api/ と netlify/functions/ を跨ぐ import も、同じ理由で禁止(二重に書く決まり)。
 */
describe("サーバー関数の相対 import", () => {
  for (const dir of ["api", "netlify/functions"]) {
    for (const file of readdirSync(new URL(`../../${dir}/`, import.meta.url)).filter((name) => name.endsWith(".ts"))) {
      it(`${dir}/${file}: 相対 import に .js を付け、別のフォルダを跨がない`, () => {
        const source = readFileSync(new URL(`../../${dir}/${file}`, import.meta.url), "utf8");
        const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+"(\.{1,2}\/[^"]+)"/gm)].map((match) => match[1]);
        for (const specifier of specifiers) {
          expect(specifier, `${dir}/${file} の ${specifier}`).toMatch(/\.js$/);
          expect(specifier, `${dir}/${file} の ${specifier}`).not.toMatch(/\.\.\//);
        }
      });
    }
  }
});
