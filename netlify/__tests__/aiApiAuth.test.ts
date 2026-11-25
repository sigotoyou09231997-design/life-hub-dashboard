import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import extractReceipt from "../../api/extractReceipt";
import extractTripPlan from "../../api/extractTripPlan";
import generateDraft from "../../api/generateDraft";

/** AI を使う窓口は、ログイン中の人しか使えない(2026-11-26 まで誰でも呼べ、呼ばれるたびに本人の Anthropic 料金が
 * かかっていた)。ログインの証明が無い・偽物なら、AI へ送る前に断ることを、3つの窓口それぞれで確かめる。 */

const handlers = [
  { name: "extractReceipt", handler: extractReceipt, body: { imageBase64: "aGVsbG8=", mediaType: "image/jpeg" } },
  { name: "extractTripPlan", handler: extractTripPlan, body: { text: "1日目 10:00 清水寺" } },
  { name: "generateDraft", handler: generateDraft, body: { subject: "件名", body: "本文", from: "a@example.com" } },
] as const;

let calls: string[] = [];
let sessionOk = true;

function fakeRes() {
  const res = { statusCode: 0, body: undefined as unknown };
  const api = {
    status(code: number) {
      res.statusCode = code;
      return api;
    },
    json(body: unknown) {
      res.body = body;
      return api;
    },
    setHeader() {
      return api;
    },
  };
  return { res, api: api as unknown as VercelResponse };
}

beforeEach(() => {
  calls = [];
  sessionOk = true;
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/auth/v1/user")) return new Response("{}", { status: sessionOk ? 200 : 401 });
      // AI の答え(中身は問わない。ここまで来たかだけを見る)。
      return new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }] }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each(handlers)("$name", ({ handler, body }) => {
  it("ログインの証明が無ければ 401 で断り、AI を呼ばない", async () => {
    const { res, api } = fakeRes();
    await handler({ method: "POST", headers: {}, body } as unknown as VercelRequest, api);
    expect(res.statusCode).toBe(401);
    expect(calls.some((url) => url.includes("anthropic.com"))).toBe(false);
  });

  it("偽物・期限切れの証明も 401 で断り、AI を呼ばない", async () => {
    sessionOk = false;
    const { res, api } = fakeRes();
    await handler({ method: "POST", headers: { authorization: "Bearer bad" }, body } as unknown as VercelRequest, api);
    expect(res.statusCode).toBe(401);
    expect(calls.some((url) => url.includes("/auth/v1/user"))).toBe(true);
    expect(calls.some((url) => url.includes("anthropic.com"))).toBe(false);
  });

  it("ログイン中の人なら、確かめたあと AI へ進む", async () => {
    const { api } = fakeRes();
    await handler({ method: "POST", headers: { authorization: "Bearer good" }, body } as unknown as VercelRequest, api);
    const authIndex = calls.findIndex((url) => url.includes("/auth/v1/user"));
    const aiIndex = calls.findIndex((url) => url.includes("anthropic.com"));
    expect(authIndex).toBeGreaterThanOrEqual(0);
    expect(aiIndex).toBeGreaterThan(authIndex);
  });
});
