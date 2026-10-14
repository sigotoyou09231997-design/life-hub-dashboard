import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { access_token: "t", user: { id: "u1" } } as null | { access_token: string; user: { id: string } },
  /** サーバーに無い列(流していない SQL の列)。 */
  missing: new Set<string>(),
  failWith: null as null | { code?: string; message: string },
  selects: [] as string[],
  /** 更新に渡された中身。status_note の列が無い時は、その列を付けた更新が失敗する。 */
  updates: [] as Record<string, unknown>[],
  noNoteColumn: false,
  noEstimateColumn: false,
}));

vi.mock("./supabase", () => ({
  isSupabaseConfigured: true,
  getSupabaseConfig: () => ({ url: "https://example.supabase.co", anonKey: "anon" }),
  auth: { getSession: async () => ({ data: { session: mocks.session } }) },
}));

vi.mock("./supabaseData", () => ({
  getSupabaseDataClient: async () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          mocks.updates.push(patch);
          if (mocks.noNoteColumn && "status_note" in patch) return { error: { code: "42703", message: "column app_feedback.status_note does not exist" } };
          if (mocks.noEstimateColumn && "estimate_minutes" in patch) return { error: { code: "42703", message: "column app_feedback.estimate_minutes does not exist" } };
          return { error: null };
        },
      }),
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
            // 本物のサーバーと同じに、頼んだ列だけを返す(外した列の値が紛れ込まないように)。
            const wanted = new Set(columns.split(",").map((c) => c.trim()));
            const full: Record<string, unknown> = { id: "f1", via: "app", message: "直して", status: "working", created_at: "2026-10-13T03:00:00Z", working_at: "2026-10-13T03:10:00Z", image_count: 2, status_note: null, estimate_minutes: 6 };
            const row = Object.fromEntries(Object.entries(full).filter(([key]) => wanted.has(key)));
            return resolve({ data: [row], error: null });
          },
        };
        return q;
      },
    }),
  }),
}));

import { loadFeedback, loadRecentFeedback, setFeedbackStatus } from "./appFeedback";

beforeEach(() => {
  mocks.session = { access_token: "t", user: { id: "u1" } };
  mocks.missing = new Set();
  mocks.failWith = null;
  mocks.selects = [];
  mocks.updates = [];
  mocks.noNoteColumn = false;
  mocks.noEstimateColumn = false;
});

describe("loadFeedback(あとから足された列が、本番に無くても読める)", () => {
  it("列が全部あれば、画像の枚数も、いつから修正中かも付いてくる", async () => {
    const items = await loadFeedback();
    expect(items[0]).toMatchObject({ id: "f1", status: "working", workingAt: "2026-10-13T03:10:00Z", imageCount: 2, estimateMinutes: 6 });
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

  it("033 も 035 も流す前でも、残っている列(保留の理由)つきで読める", async () => {
    mocks.missing = new Set(["working_at", "image_count"]);
    const items = await loadFeedback();
    expect(mocks.selects).toHaveLength(3);
    expect(mocks.selects[2]).toBe("id, via, sender_name, trip_name, page, message, app_version, status, created_at, status_note, estimate_minutes, question_options, answer, answered_at");
    expect(items).toHaveLength(1);
  });

  it("033・035・036・037・039 のどれも流す前なら、元の列だけで読める", async () => {
    mocks.missing = new Set(["working_at", "image_count", "status_note", "estimate_minutes", "question_options", "answer", "answered_at"]);
    const items = await loadFeedback();
    // 全部付けた1回目と、無い列を1つずつ外す7回。
    expect(mocks.selects).toHaveLength(8);
    expect(mocks.selects[7]).toBe("id, via, sender_name, trip_name, page, message, app_version, status, created_at");
    expect(items).toHaveLength(1);
  });

  it("036 を流す前(status_note が無い)でも、ほかの列で読み直す。保留の理由は読めた時だけ付く", async () => {
    mocks.missing = new Set(["status_note"]);
    const items = await loadFeedback();
    expect(mocks.selects).toHaveLength(2);
    expect(mocks.selects[1]).not.toContain("status_note");
    expect(items[0].statusNote).toBeUndefined();
  });

  it("037 を流す前(estimate_minutes が無い)でも、ほかの列で読み直す。目安は読めた時だけ付く", async () => {
    mocks.missing = new Set(["estimate_minutes"]);
    const items = await loadFeedback();
    expect(mocks.selects).toHaveLength(2);
    expect(mocks.selects[1]).not.toContain("estimate_minutes");
    expect(mocks.selects[1]).toContain("status_note");
    expect(items[0].estimateMinutes).toBeUndefined();
    expect(items[0].workingAt).toBe("2026-10-13T03:10:00Z");
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

describe("setFeedbackStatus(保留の理由は、保留の間だけ)", () => {
  it("保留中にする時は、理由を触らない。ほかの状態にする時は、理由を消す", async () => {
    await setFeedbackStatus("f1", "hold");
    await setFeedbackStatus("f1", "done");
    expect(mocks.updates[0]).toEqual({ status: "hold", resolved_at: null, estimate_minutes: null });
    expect(mocks.updates[1]).toMatchObject({ status: "done", status_note: null, resolved_at: expect.any(String) });
  });

  it("かかる時間の目安は、未対応・保留中・修正中にしたら消す。対応済み・見送りは残す(古い目安のゲージを出さない)", async () => {
    for (const status of ["new", "hold", "working", "done", "dismissed"] as const) await setFeedbackStatus("f1", status);
    expect(mocks.updates.map((patch) => "estimate_minutes" in patch)).toEqual([true, true, true, false, false]);
    expect(mocks.updates[0].estimate_minutes).toBeNull();
  });

  it("037 を流す前(estimate_minutes の列が無い)でも、状態は変えられる。036 も無ければ、両方外して更新し直す", async () => {
    mocks.noEstimateColumn = true;
    await setFeedbackStatus("f1", "working");
    expect(mocks.updates).toHaveLength(2);
    expect(mocks.updates[1]).not.toHaveProperty("estimate_minutes");
    expect(mocks.updates[1]).toMatchObject({ status: "working", status_note: null });
    mocks.updates = [];
    mocks.noNoteColumn = true;
    await setFeedbackStatus("f1", "new");
    expect(mocks.updates).toHaveLength(3);
    expect(mocks.updates[2]).toEqual({ status: "new", resolved_at: null });
  });

  it("未対応・修正中・保留中は、終わった時刻(resolved_at)を空にする", async () => {
    for (const status of ["new", "working", "hold"] as const) await setFeedbackStatus("f1", status);
    expect(mocks.updates.map((patch) => patch.resolved_at)).toEqual([null, null, null]);
  });

  it("036 を流す前(status_note の列が無い)でも、状態は変えられる(理由なしで更新し直す)", async () => {
    mocks.noNoteColumn = true;
    await setFeedbackStatus("f1", "done");
    expect(mocks.updates).toHaveLength(2);
    expect(mocks.updates[1]).not.toHaveProperty("status_note");
    expect(mocks.updates[1]).toMatchObject({ status: "done" });
  });
});

