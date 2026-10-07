import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SEND_TRIP_PLAN_TOOL,
  SUPPORTED_PROTOCOL_VERSIONS,
  TOOL_NAME,
  handleMcpBody,
  handleMcpMessage,
  handler as netlifyHandler,
} from "../functions/mcp";
import vercelHandler, {
  SEND_TRIP_PLAN_TOOL as VERCEL_TOOL,
  handleMcpBody as vercelHandleMcpBody,
  handleMcpMessage as vercelHandleMcpMessage,
} from "../../api/mcp";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const CODE = "LH-ABCD-EFGH-JKLM-NPQR-STUV";

function call(method: string, params?: unknown, id: number | string | null = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

function stubSupabase(rpc: { status: number; body: unknown }) {
  const fetchMock = vi.fn(async () => ({ status: rpc.status, json: async () => rpc.body }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
  return fetchMock;
}

const validArgs = () => ({
  code: CODE,
  tripName: "四国旅行",
  startDate: "2026-12-27",
  endDate: "2026-12-27",
  items: [{ date: "2026-12-27", startTime: "9:00", title: "羽田→高松", type: "transport", endLocation: "高松空港", amount: 9000 }],
});

describe("initialize / ping / 通知", () => {
  it("クライアントが挙げた版が対応済みなら、そのまま返す。無ければいちばん新しい版を返す", async () => {
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      const reply = await handleMcpMessage(call("initialize", { protocolVersion: version }));
      expect(reply).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: version } });
    }
    const unknown = await handleMcpMessage(call("initialize", { protocolVersion: "1999-01-01" }));
    expect(unknown).toMatchObject({ result: { protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0] } });
    const none = await handleMcpMessage(call("initialize"));
    expect(none).toMatchObject({ result: { protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0] } });
  });

  it("ツールだけを持つサーバーだと名乗る(資源・プロンプトは持たない)", async () => {
    const reply = (await handleMcpMessage(call("initialize", { protocolVersion: "2025-06-18" }, "abc"))) as {
      id: string;
      result: { capabilities: Record<string, unknown>; serverInfo: { name: string } };
    };
    expect(reply.id).toBe("abc");
    expect(Object.keys(reply.result.capabilities)).toEqual(["tools"]);
    expect(reply.result.serverInfo.name).toBe("life-hub-trip-inbox");
  });

  it("ping には空で答える。通知(id なし)には返事をしない", async () => {
    expect(await handleMcpMessage(call("ping"))).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    // 知らない通知も、黙って受ける。
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/whatever" })).toBeNull();
    // 相手からの返事も受け取るだけ。
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 5, result: {} })).toBeNull();
  });

  it("壊れたメッセージ・知らない方法には、JSON-RPC のエラーで返す", async () => {
    for (const bad of [null, "text", 42, [], { id: 1, method: "ping" }, { jsonrpc: "1.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 1 }]) {
      expect(await handleMcpMessage(bad), JSON.stringify(bad)).toMatchObject({ error: { code: -32600 } });
    }
    expect(await handleMcpMessage(call("resources/list"))).toMatchObject({ id: 1, error: { code: -32601 } });
  });
});

describe("tools/list", () => {
  it("送るツールを1つだけ出す。受信箱に置くだけで、日程を変えない・読むだけでもない", async () => {
    const reply = (await handleMcpMessage(call("tools/list"))) as { result: { tools: (typeof SEND_TRIP_PLAN_TOOL)[] } };
    expect(reply.result.tools).toHaveLength(1);
    const tool = reply.result.tools[0];
    expect(tool.name).toBe(TOOL_NAME);
    expect(tool.inputSchema.required).toEqual(["code", "items"]);
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    // 金額の項目は持たない(GPTの見積もりが旅行の費用に積まれないように)。
    expect(Object.keys(tool.inputSchema.properties.items.items.properties)).not.toContain("amount");
  });

  it("入力の定義が、GPT用の接続定義(openapi.json)と同じ(片方だけ直して食い違わないように)", () => {
    const spec = JSON.parse(readFileSync(new URL("../../public/chatgpt/openapi.json", import.meta.url), "utf8"));
    const schema = spec.paths["/api/receiveTripPlan"].post.requestBody.content["application/json"].schema;
    expect(SEND_TRIP_PLAN_TOOL.inputSchema).toEqual(schema);
  });

  it("Vercel版とNetlify版で同じ定義", () => {
    expect(VERCEL_TOOL).toEqual(SEND_TRIP_PLAN_TOOL);
  });
});

describe("tools/call", () => {
  it("検証済みの予定を Supabase の関数へ渡し、届いたことを構造化して返す(金額は渡さない)", async () => {
    const fetchMock = stubSupabase({ status: 200, body: { ok: true, received: 1 } });
    const reply = (await handleMcpMessage(call("tools/call", { name: TOOL_NAME, arguments: validArgs() }))) as {
      result: { isError: boolean; content: { type: string; text: string }[]; structuredContent: Record<string, unknown> };
    };
    expect(reply.result.isError).toBe(false);
    expect(reply.result.structuredContent).toMatchObject({ ok: true, received: 1, skipped: 0 });
    expect(reply.result.content[0].text).toContain("受信箱に1件");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.supabase.co/rest/v1/rpc/receive_chatgpt_trip");
    const sent = JSON.parse(init.body as string);
    expect(sent.p_code).toBe("LHABCDEFGHJKLMNPQRSTUV");
    expect(sent.p_items).toEqual([{ date: "2026-12-27", startTime: "09:00", title: "羽田→高松", type: "transport", endLocation: "高松空港" }]);
    expect(JSON.stringify(sent)).not.toContain("9000");
  });

  it("コードが違う時は、ツールの失敗(isError)として、理由を返す", async () => {
    stubSupabase({ status: 200, body: { ok: false, reason: "invalid_code" } });
    const reply = (await handleMcpMessage(call("tools/call", { name: TOOL_NAME, arguments: validArgs() }))) as {
      result: { isError: boolean; content: { text: string }[]; structuredContent: Record<string, unknown> };
    };
    expect(reply.result.isError).toBe(true);
    expect(reply.result.structuredContent.ok).toBe(false);
    expect(reply.result.content[0].text).toContain("もう一度聞いてください");
  });

  it("内容が駄目な時は、Supabase を呼ばずに理由を返す。引数が無くても落ちない", async () => {
    const fetchMock = stubSupabase({ status: 200, body: { ok: true } });
    for (const args of [{ ...validArgs(), items: [] }, { ...validArgs(), code: "" }, undefined, "text", null]) {
      const reply = (await handleMcpMessage(call("tools/call", { name: TOOL_NAME, arguments: args }))) as {
        result: { isError: boolean; content: { text: string }[] };
      };
      expect(reply.result.isError, JSON.stringify(args)).toBe(true);
      expect(reply.result.content[0].text.length).toBeGreaterThan(0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("LIFE HUB 側の準備中・通信の失敗も、ツールの失敗として返す", async () => {
    stubSupabase({ status: 404, body: {} });
    const notReady = (await handleMcpMessage(call("tools/call", { name: TOOL_NAME, arguments: validArgs() }))) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(notReady.result.isError).toBe(true);
    expect(notReady.result.content[0].text).toContain("準備がまだ終わっていません");

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network");
    }));
    const down = (await handleMcpMessage(call("tools/call", { name: TOOL_NAME, arguments: validArgs() }))) as {
      result: { isError: boolean };
    };
    expect(down.result.isError).toBe(true);
  });

  it("知らないツールは、JSON-RPC のエラー", async () => {
    expect(await handleMcpMessage(call("tools/call", { name: "delete_everything", arguments: {} }))).toMatchObject({
      error: { code: -32602 },
    });
  });
});

describe("handleMcpBody", () => {
  it("配列でも処理し、返事が要るものだけ返す。全部が通知なら返事なし", async () => {
    const mixed = await handleMcpBody([call("ping", undefined, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, call("tools/list", undefined, 2)]);
    expect(mixed).toHaveLength(2);
    expect(await handleMcpBody([{ jsonrpc: "2.0", method: "notifications/initialized" }])).toBeNull();
    expect(await handleMcpBody([])).toMatchObject({ error: { code: -32600 } });
  });
});

describe("Netlify版とVercel版のずれ", () => {
  it("同じメッセージから同じ返事を作る", async () => {
    stubSupabase({ status: 200, body: { ok: true } });
    const messages: unknown[] = [
      call("initialize", { protocolVersion: "2025-03-26" }),
      call("initialize"),
      call("ping"),
      call("tools/list"),
      call("tools/call", { name: TOOL_NAME, arguments: validArgs() }),
      call("tools/call", { name: TOOL_NAME, arguments: { code: "" } }),
      call("tools/call", { name: "nope" }),
      call("resources/list"),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      null,
      [],
    ];
    for (const message of messages) {
      expect(await vercelHandleMcpMessage(message), JSON.stringify(message)).toEqual(await handleMcpMessage(message));
    }
    const batch = [call("ping", undefined, 1), call("tools/list", undefined, 2)];
    expect(await vercelHandleMcpBody(batch)).toEqual(await handleMcpBody(batch));
  });
});

/** HTTP の入口(Vercel版・Netlify版)。受け付ける形と、断り方を確かめる。 */
describe("受け口(handler)", () => {
  type Reply = { status: number; json?: unknown; headers: Record<string, string> };

  async function callVercel(method: string, body: unknown): Promise<Reply> {
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
    await vercelHandler({ method, body } as never, res as never);
    return reply;
  }

  async function callNetlify(method: string, body: unknown): Promise<Reply> {
    const result = (await netlifyHandler(
      { httpMethod: method, body: typeof body === "string" ? body : JSON.stringify(body) } as never,
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
      it("initialize には JSON で答える", async () => {
        const reply = await send("POST", call("initialize", { protocolVersion: "2025-06-18" }));
        expect(reply.status).toBe(200);
        expect(reply.json).toMatchObject({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "life-hub-trip-inbox" } } });
      });

      it("通知には 202(本文なし)", async () => {
        const reply = await send("POST", { jsonrpc: "2.0", method: "notifications/initialized" });
        expect(reply.status).toBe(202);
        expect(reply.json).toBeUndefined();
      });

      it("tools/call を、最後(Supabase)まで通す", async () => {
        stubSupabase({ status: 200, body: { ok: true } });
        const reply = await send("POST", call("tools/call", { name: TOOL_NAME, arguments: validArgs() }));
        expect(reply.status).toBe(200);
        expect(reply.json).toMatchObject({ result: { isError: false, structuredContent: { ok: true, received: 1 } } });
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
});
