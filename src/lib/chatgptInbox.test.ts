import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  userId: "user-1" as string | undefined,
  email: "sigotoyou09231997@gmail.com" as string | undefined,
  /** from(表名) の呼び出しを記録し、表ごとに決めた応答を返す。 */
  tables: {} as Record<string, { data?: unknown; error?: { code?: string; message?: string } | null }>,
  calls: [] as { table: string; op: string; args: unknown[] }[],
}));

vi.mock("./supabase", () => ({
  get isSupabaseConfigured() {
    return mocks.configured;
  },
  auth: {
    getSession: async () => ({ data: { session: mocks.userId ? { user: { id: mocks.userId, email: mocks.email } } : null } }),
  },
}));

vi.mock("./supabaseData", () => ({
  getSupabaseDataClient: async () => ({
    from: (table: string) => {
      const result = () => ({ data: mocks.tables[table]?.data ?? null, error: mocks.tables[table]?.error ?? null });
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "upsert", "delete", "eq", "order", "maybeSingle"]) {
        chain[op] = (...args: unknown[]) => {
          mocks.calls.push({ table, op, args });
          return chain;
        };
      }
      // await された時に応答を返す(supabase-js のクエリも await できる)。
      chain.then = (resolve: (value: unknown) => void) => resolve(result());
      return chain;
    },
  }),
}));

import {
  createSendCode,
  deleteInboxEntry,
  formatSendCode,
  hashSendCode,
  canUseDirectSend,
  isMissingTable,
  loadInbox,
  loadSendCodeState,
  newSendCode,
  normalizeSendCode,
  parseInboxItems,
  revokeSendCode,
} from "./chatgptInbox";

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => void (store[key] = value),
    removeItem: (key: string) => void delete store[key],
  });
  return store;
}

beforeEach(() => {
  mocks.configured = true;
  mocks.userId = "user-1";
  mocks.email = "sigotoyou09231997@gmail.com";
  mocks.tables = {};
  mocks.calls = [];
});

afterEach(() => vi.unstubAllGlobals());

describe("送信コード", () => {
  it("LH + 20文字。紛らわしい文字(I・O・0・1)を使わず、毎回違う", () => {
    const codes = new Set(Array.from({ length: 200 }, () => newSendCode()));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^LH[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{20}$/);
  });

  it("区切り付きにしても、正規化すれば元のコードに戻る", () => {
    const code = newSendCode();
    const shown = formatSendCode(code);
    expect(shown).toMatch(/^LH(-[A-Z2-9]{4}){5}$/);
    expect(normalizeSendCode(shown)).toBe(code);
    expect(normalizeSendCode(shown.toLowerCase().replace(/-/g, " "))).toBe(code);
  });

  it("表に置く値は SHA-256(16進・小文字)。区切りや大文字小文字が違っても同じ値になる", async () => {
    // Supabase の関数 receive_chatgpt_trip の encode(sha256(...), 'hex') と同じ計算。
    // 既知の値: SHA-256("ABC")。コードは正規化(大文字)してから計算する。
    expect(await hashSendCode("ABC")).toBe("b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78");
    expect(await hashSendCode("abc")).toBe(await hashSendCode("ABC"));
    expect(await hashSendCode("LH-abcd")).toBe(await hashSendCode("LHABCD"));
  });
});

describe("canUseDirectSend", () => {
  it("許可したメールだけ。大文字小文字・前後の空白は見ない", () => {
    expect(canUseDirectSend("sigotoyou09231997@gmail.com")).toBe(true);
    expect(canUseDirectSend("  SigotoYou09231997@Gmail.com ")).toBe(true);
    expect(canUseDirectSend("friend@example.com")).toBe(false);
    expect(canUseDirectSend("")).toBe(false);
    expect(canUseDirectSend(undefined)).toBe(false);
  });
});

describe("isMissingTable", () => {
  it("表・関数が無い時の応答だけを、そう判定する", () => {
    expect(isMissingTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable({ message: 'relation "x" does not exist' })).toBe(true);
    expect(isMissingTable({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});

describe("parseInboxItems", () => {
  it("日程として使える項目だけを残し、金額は受け取らない", () => {
    const items = parseInboxItems([
      { date: "2026-12-27", startTime: "09:00", endTime: "08:00", title: "羽田→高松", type: "transport", endLocation: "高松空港", amount: 9000 },
      { date: "2026-12-27", startTime: "25:00", title: "時刻が不正", type: "hotel" },
      { date: "2026-02-30", title: "実在しない日" },
      { date: "2026-12-27" },
      "文字列",
      null,
    ]);
    expect(items).toEqual([
      expect.objectContaining({ title: "羽田→高松", startTime: "09:00", endTime: undefined, endLocation: "高松空港", type: "transport" }),
      expect.objectContaining({ title: "時刻が不正", startTime: undefined, type: "other" }),
    ]);
    expect(JSON.stringify(items)).not.toContain("9000");
  });

  it("配列でなければ空", () => {
    expect(parseInboxItems(undefined)).toEqual([]);
    expect(parseInboxItems({ items: [] })).toEqual([]);
  });
});

describe("loadSendCodeState", () => {
  it("ログインしていない・未設定・SQLを流す前(表が無い)なら、機能を出さない", async () => {
    mocks.userId = undefined;
    expect(await loadSendCodeState()).toEqual({ kind: "unavailable" });
    mocks.userId = "user-1";
    mocks.configured = false;
    expect(await loadSendCodeState()).toEqual({ kind: "unavailable" });
    mocks.configured = true;
    mocks.tables.chatgpt_send_codes = { error: { code: "PGRST205", message: "Could not find the table" } };
    expect(await loadSendCodeState()).toEqual({ kind: "unavailable" });
  });

  it("コードが無ければ、許可されたアカウントには none(作れる)", async () => {
    mocks.tables.chatgpt_send_codes = { data: null };
    expect(await loadSendCodeState()).toEqual({ kind: "none" });
  });

  it("許可されていないアカウント(友人など)には、コードが無ければ欄ごと出さない", async () => {
    // 専用GPTは作った本人しか使えない。使えない機能の案内を、友人の画面に出さない。
    mocks.email = "friend@example.com";
    mocks.tables.chatgpt_send_codes = { data: null };
    expect(await loadSendCodeState()).toEqual({ kind: "unavailable" });
    mocks.email = undefined;
    expect(await loadSendCodeState()).toEqual({ kind: "unavailable" });
  });

  it("すでにコードを作ってあるアカウントには、メールが一覧に無くても出す(作った後で欄が消えないように)", async () => {
    mocks.email = "other-login@example.com";
    mocks.tables.chatgpt_send_codes = { data: { code_hash: await hashSendCode(newSendCode()), created_at: "2026-10-06T00:00:00Z" } };
    expect(await loadSendCodeState()).toMatchObject({ kind: "active" });
  });

  it("この端末で作ったコードが表の値と合う時だけ、コードを見せる", async () => {
    const code = newSendCode();
    mocks.tables.chatgpt_send_codes = { data: { code_hash: await hashSendCode(code), created_at: "2026-10-06T00:00:00Z" } };
    stubLocalStorage({ "lifehub.chatgptSendCode": JSON.stringify({ userId: "user-1", code }) });
    expect(await loadSendCodeState()).toEqual({ kind: "active", createdAt: "2026-10-06T00:00:00Z", code: formatSendCode(code) });

    // 別の端末で作り直された後の、古い控えは見せない。
    mocks.tables.chatgpt_send_codes = { data: { code_hash: await hashSendCode(newSendCode()), created_at: "2026-10-07T00:00:00Z" } };
    expect(await loadSendCodeState()).toEqual({ kind: "active", createdAt: "2026-10-07T00:00:00Z", code: undefined });
  });

  it("別のアカウントの控えは見せない", async () => {
    const code = newSendCode();
    mocks.tables.chatgpt_send_codes = { data: { code_hash: await hashSendCode(code), created_at: "x" } };
    stubLocalStorage({ "lifehub.chatgptSendCode": JSON.stringify({ userId: "someone-else", code }) });
    expect(await loadSendCodeState()).toMatchObject({ kind: "active", code: undefined });
  });
});

describe("createSendCode / revokeSendCode", () => {
  it("表にはコードそのものでなく値の要約を置き、この端末には控えを残す", async () => {
    const store = stubLocalStorage();
    const shown = await createSendCode();
    expect(shown).toMatch(/^LH(-[A-Z2-9]{4}){5}$/);

    const upsert = mocks.calls.find((call) => call.op === "upsert")!;
    expect(upsert.table).toBe("chatgpt_send_codes");
    const row = upsert.args[0] as { user_id: string; code_hash: string };
    expect(row.user_id).toBe("user-1");
    expect(row.code_hash).toBe(await hashSendCode(shown));
    expect(JSON.stringify(upsert.args)).not.toContain(normalizeSendCode(shown));
    expect(JSON.parse(store["lifehub.chatgptSendCode"])).toMatchObject({ userId: "user-1" });
  });

  it("作れなかった時は、控えを残さずエラーにする", async () => {
    const store = stubLocalStorage();
    mocks.tables.chatgpt_send_codes = { error: { message: "denied" } };
    await expect(createSendCode()).rejects.toThrow("denied");
    expect(store["lifehub.chatgptSendCode"]).toBeUndefined();
  });

  it("無効にすると、表の行も端末の控えも消す", async () => {
    const store = stubLocalStorage({ "lifehub.chatgptSendCode": JSON.stringify({ userId: "user-1", code: "X" }) });
    await revokeSendCode();
    expect(mocks.calls.some((call) => call.op === "delete" && call.table === "chatgpt_send_codes")).toBe(true);
    expect(store["lifehub.chatgptSendCode"]).toBeUndefined();
  });
});

describe("loadInbox / deleteInboxEntry", () => {
  it("届いた旅程を新しい順に返し、使える予定が1件も無いものは出さない", async () => {
    mocks.tables.chatgpt_trip_inbox = {
      data: [
        { id: "a", trip_name: "四国旅行", start_date: "2026-12-27", end_date: "2027-01-02", received_at: "2026-10-06T10:00:00Z", items: [{ date: "2026-12-27", title: "高松観光" }] },
        { id: "b", trip_name: null, start_date: null, end_date: null, received_at: "2026-10-05T10:00:00Z", items: [{ title: "日付なし" }] },
      ],
    };
    const inbox = await loadInbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ id: "a", tripName: "四国旅行", startDate: "2026-12-27" });
    expect(inbox[0].items).toEqual([expect.objectContaining({ title: "高松観光" })]);
    expect(mocks.calls.find((call) => call.op === "order")?.args).toEqual(["received_at", { ascending: false }]);
  });

  it("読めなければ空(表が無い・通信できない)", async () => {
    mocks.tables.chatgpt_trip_inbox = { error: { code: "PGRST205" } };
    expect(await loadInbox()).toEqual([]);
    mocks.userId = undefined;
    expect(await loadInbox()).toEqual([]);
  });

  it("1件を消す", async () => {
    await deleteInboxEntry("a");
    expect(mocks.calls.filter((call) => call.table === "chatgpt_trip_inbox").map((call) => [call.op, call.args])).toEqual([
      ["delete", []],
      ["eq", ["id", "a"]],
    ]);
  });
});
