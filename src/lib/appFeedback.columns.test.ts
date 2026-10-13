import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { access_token: "t", user: { id: "u1" } } as null | { access_token: string; user: { id: string } },
  /** サーバーに無い列(流していない SQL の列)。 */
  missing: new Set<string>(),
  failWith: null as null | { code?: string; message: string },
  selects: [] as string[],
}));

vi.mock("./supabase", () => ({
  isSupabaseConfigured: true,
  getSupabaseConfig: () => ({ url: "https://example.supabase.co", anonKey: "anon" }),
  auth: { getSession: async () => ({ data: { session: mocks.session } }) },
}));

vi.mock("./supabaseData", () => ({
  getSupabaseDataClient: async () => ({
    from: () => ({
      select: (columns: string) => {
        mocks.selects.push(columns);
        const q: Record<string, unknown> = {
          gte: () => q,
          order: () => q,
          limit: () => q,
          then: (resolve: (value: unknown) => unknown) => {
            if (mocks.failWith) return resolve({ data: null, error: mocks.failWith });
            const gone = columns.split(",").map((c) => c.trim()).find((c) => mocks.missing.has(c));
            if (gone) return resolve({ data: null, error: { code: "42703", message: `column app_feedback.${gone} does not exist` } });
            return resolve({
              data: [{ id: "f1", via: "app", message: "直して", status: "working", created_at: "2026-10-13T03:00:00Z", working_at: "2026-10-13T03:10:00Z", image_count: 2 }],
              error: null,
            });
          },
        };
        return q;
      },
    }),
  }),
}));

import { loadFeedback, loadRecentFeedback } from "./appFeedback";

beforeEach(() => {
  mocks.session = { access_token: "t", user: { id: "u1" } };
  mocks.missing = new Set();
  mocks.failWith = null;
  mocks.selects = [];
});

describe("loadFeedback(あとから足された列が、本番に無くても読める)", () => {
  it("列が全部あれば、画像の枚数も、いつから修正中かも付いてくる", async () => {
    const items = await loadFeedback();
    expect(items[0]).toMatchObject({ id: "f1", status: "working", workingAt: "2026-10-13T03:10:00Z", imageCount: 2 });
    expect(mocks.selects).toHaveLength(1);
  });

  it("035 を流す前(working_at が無い)でも、その列だけ外して読み直す", async () => {
    mocks.missing = new Set(["working_at"]);
    const items = await loadFeedback();
    expect(mocks.selects).toHaveLength(2);
    expect(mocks.selects[1]).not.toContain("working_at");
    expect(mocks.selects[1]).toContain("image_count");
    expect(items[0].id).toBe("f1");
  });

  it("033 も 035 も流す前でも、元の列だけで読める", async () => {
    mocks.missing = new Set(["working_at", "image_count"]);
    const items = await loadFeedback();
    expect(mocks.selects).toHaveLength(3);
    expect(mocks.selects[2]).toBe("id, via, sender_name, trip_name, page, message, app_version, status, created_at");
    expect(items).toHaveLength(1);
  });

  it("列が無いのとは関係ない失敗は、そのまま投げる(読めたふりをしない)", async () => {
    mocks.failWith = { code: "42501", message: "permission denied for table app_feedback" };
    await expect(loadFeedback()).rejects.toMatchObject({ code: "42501" });
    expect(mocks.selects).toHaveLength(1);
  });
});

describe("loadRecentFeedback(「修正中です」を出すための、自分が見られる最近の依頼)", () => {
  it("最近の依頼を新しい順に返す。035 を流す前でも読める", async () => {
    mocks.missing = new Set(["working_at"]);
    const items = await loadRecentFeedback(5);
    expect(items).toHaveLength(1);
  });

  it("ログインしていない・読めない時は、空(画面には何も出さない。エラーにもしない)", async () => {
    mocks.session = null;
    expect(await loadRecentFeedback()).toEqual([]);
    expect(mocks.selects).toHaveLength(0);
    mocks.session = { access_token: "t", user: { id: "u1" } };
    mocks.failWith = { code: "42P01", message: 'relation "public.app_feedback" does not exist' };
    expect(await loadRecentFeedback()).toEqual([]);
  });
});
