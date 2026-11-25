import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** AI の窓口はログインの証明が無いと断る(api/ 側。2026-11-26)。画面からは、ログイン中なら必ず証明を付けて送る。 */
const session = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("./supabase", () => ({
  auth: {
    getSession: async () => ({ data: { session: session.token ? { access_token: session.token } : null } }),
  },
}));

import { authorizationHeader } from "./apiAuth";
import { extractFixedCostFromImage, extractReceiptFromImage } from "./receiptScan";
import { extractTripPlanFromSources } from "./tripPlanScan";
import { generateDraft } from "./gmail";

let sentHeaders: Array<Record<string, string>> = [];

beforeEach(() => {
  session.token = "token-123";
  sentHeaders = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentHeaders.push({ ...(init?.headers as Record<string, string>) });
      return new Response(JSON.stringify({ receipt: null, fixedCost: null, items: [], draft: "" }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI の窓口へのログインの証明", () => {
  it("ログイン中なら Bearer を返し、していなければ空", async () => {
    expect(await authorizationHeader()).toEqual({ authorization: "Bearer token-123" });
    session.token = null;
    expect(await authorizationHeader()).toEqual({});
  });

  it("レシート・固定費・旅行の日程・メールの下書きは、どれも証明を付けて送る", async () => {
    await extractReceiptFromImage("aGVsbG8=", "image/jpeg", "2026-11-26");
    await extractFixedCostFromImage("aGVsbG8=", "image/jpeg", "2026-11-26");
    await extractTripPlanFromSources({ text: "1日目 清水寺", today: "2026-11-26" });
    await generateDraft({ subject: "件名", body: "本文", from: "a@example.com" } as Parameters<typeof generateDraft>[0]);

    expect(sentHeaders).toHaveLength(4);
    for (const headers of sentHeaders) {
      expect(headers.authorization).toBe("Bearer token-123");
      expect(headers["content-type"]).toBe("application/json");
    }
  });
});
