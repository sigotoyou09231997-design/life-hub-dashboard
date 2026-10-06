import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ITEMS,
  handler as netlifyHandler,
  interpretRpcResult,
  normalizeCode,
  normalizeDate,
  normalizeTime,
  parseReceivedPlan,
} from "../functions/receiveTripPlan";
import vercelHandler, {
  MAX_ITEMS as VERCEL_MAX_ITEMS,
  interpretRpcResult as vercelInterpretRpcResult,
  normalizeCode as vercelNormalizeCode,
  normalizeDate as vercelNormalizeDate,
  normalizeTime as vercelNormalizeTime,
  parseReceivedPlan as vercelParseReceivedPlan,
} from "../../api/receiveTripPlan";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const CODE = "LH-ABCD-EFGH-JKLM-NPQR-STUV";

function okBody(extra: Record<string, unknown> = {}) {
  return {
    code: CODE,
    tripName: "四国旅行",
    startDate: "2026-12-27",
    endDate: "2027-01-02",
    items: [
      { date: "2026-12-27", startTime: "09:00", title: "羽田→高松", type: "transport", location: "羽田空港", endLocation: "高松空港" },
      { date: "2026-12-27", startTime: "07:00", title: "起床・朝食", type: "other" },
    ],
    ...extra,
  };
}

describe("正規化", () => {
  it("コードは、区切りや小文字があっても同じ値にそろえる", () => {
    expect(normalizeCode("LH-abcd efgh")).toBe("LHABCDEFGH");
    expect(normalizeCode(" ＬＨ－ＡＢＣＤ ")).toBe("LHABCD");
    expect(normalizeCode(undefined)).toBe("");
    expect(normalizeCode(123)).toBe("");
  });

  it("日付・時刻の書き方の揺れを直す。実在しない日・時刻は通さない", () => {
    expect(normalizeDate("2026-9-3")).toBe("2026-09-03");
    expect(normalizeDate("2026/12/27")).toBe("2026-12-27");
    expect(normalizeDate("2026-02-30")).toBeUndefined();
    expect(normalizeDate("12/27")).toBeUndefined();
    expect(normalizeTime("9:00")).toBe("09:00");
    expect(normalizeTime("24:00")).toBeUndefined();
    expect(normalizeTime("9時")).toBeUndefined();
  });
});

describe("parseReceivedPlan", () => {
  it("日付→時刻の順に並べて、受信箱へ置く形にする", () => {
    const parsed = parseReceivedPlan(okBody());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.plan.code).toBe("LHABCDEFGHJKLMNPQRSTUV");
    expect(parsed.plan.tripName).toBe("四国旅行");
    expect(parsed.plan.startDate).toBe("2026-12-27");
    expect(parsed.plan.items.map((item) => item.title)).toEqual(["起床・朝食", "羽田→高松"]);
    expect(parsed.plan.items[1]).toMatchObject({ endLocation: "高松空港", type: "transport" });
  });

  it("金額は受け取らない(GPTの見積もりが旅行の費用に積まれないように)", () => {
    const parsed = parseReceivedPlan(okBody({ items: [{ date: "2026-12-27", title: "昼食", amount: 3000, price: 3000 }] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.plan.items[0])).not.toContain("amount");
    expect(JSON.stringify(parsed.plan.items)).not.toContain("3000");
  });

  it("コードが無ければ、ユーザーに聞くよう伝える理由を返す", () => {
    const parsed = parseReceivedPlan(okBody({ code: "" }));
    expect(parsed).toMatchObject({ ok: false, status: 400 });
    if (!parsed.ok) expect(parsed.message).toContain("ユーザーに聞いてください");
  });

  it("予定が空・多すぎる時は、理由を返す", () => {
    expect(parseReceivedPlan(okBody({ items: [] }))).toMatchObject({ ok: false, status: 400 });
    expect(parseReceivedPlan(okBody({ items: "なし" }))).toMatchObject({ ok: false, status: 400 });
    const many = Array.from({ length: MAX_ITEMS + 1 }, () => ({ date: "2026-12-27", title: "散策" }));
    const parsed = parseReceivedPlan(okBody({ items: many }));
    expect(parsed).toMatchObject({ ok: false, status: 400 });
    if (!parsed.ok) expect(parsed.message).toContain("分けて");
  });

  it("日付か題名の無い予定は捨てて、捨てた数を数える。全部駄目なら理由を返す", () => {
    const mixed = parseReceivedPlan(
      okBody({ items: [{ date: "2026-12-27", title: "高松観光" }, { title: "日付なし" }, { date: "2026-12-27" }, "文字列", null] }),
    );
    expect(mixed.ok).toBe(true);
    if (mixed.ok) expect(mixed.plan).toMatchObject({ skipped: 4, items: [expect.objectContaining({ title: "高松観光" })] });

    expect(parseReceivedPlan(okBody({ items: [{ title: "日付なし" }] }))).toMatchObject({ ok: false, status: 400 });
  });

  it("時刻の揺れは直す。読めない時刻は、予定ごと捨てずに時刻だけ外す", () => {
    const parsed = parseReceivedPlan(
      okBody({
        items: [
          { date: "2026-12-27", startTime: "9:00", endTime: "8:00", title: "終了が開始より前" },
          { date: "2026-12-27", startTime: "朝", title: "時刻が読めない" },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const byTitle = Object.fromEntries(parsed.plan.items.map((item) => [item.title, item]));
    expect(byTitle["終了が開始より前"]).toMatchObject({ startTime: "09:00", endTime: undefined });
    expect(byTitle["時刻が読めない"].startTime).toBeUndefined();
  });

  it("種類が分からなければ other。到着地は移動のものだけ残す", () => {
    const parsed = parseReceivedPlan(
      okBody({
        items: [
          { date: "2026-12-27", title: "宿", type: "hotel", endLocation: "どこか" },
          { date: "2026-12-27", title: "宿2", type: "lodging", endLocation: "どこか" },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.plan.items.map((item) => [item.type, item.endLocation])).toEqual([
      ["other", undefined],
      ["lodging", undefined],
    ]);
  });

  it("旅行の名前・期間は無くても受け取る", () => {
    const parsed = parseReceivedPlan({ code: CODE, items: [{ date: "2026-12-27", title: "高松観光" }] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.plan).toMatchObject({ tripName: undefined, startDate: undefined, endDate: undefined });
  });

  it("本文が壊れていても落ちない", () => {
    for (const body of [null, undefined, "text", 42, [], {}]) {
      expect(parseReceivedPlan(body)).toMatchObject({ ok: false });
    }
  });
});

describe("interpretRpcResult", () => {
  const plan = { code: "X", items: [{ date: "2026-12-27", title: "a", type: "other" as const }], skipped: 0 };

  it("届いた時は、件数と、アプリのどこで確かめるかを伝える", () => {
    const reply = interpretRpcResult(200, { ok: true, received: 1 }, plan);
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ ok: true, received: 1 });
    expect(reply.body.message).toContain("受信箱に1件");
    expect(reply.body.message).toContain("ChatGPTから届いた旅程");
  });

  it("捨てた予定があれば、そのことも伝える", () => {
    const reply = interpretRpcResult(200, { ok: true }, { ...plan, skipped: 2 });
    expect(reply.body.message).toContain("2件は除きました");
  });

  it("コードが違う時は 401(コードをもう一度聞くよう伝える)", () => {
    const reply = interpretRpcResult(200, { ok: false, reason: "invalid_code" }, plan);
    expect(reply.status).toBe(401);
    expect(reply.body.message).toContain("もう一度聞いてください");
  });

  it("件数の上限を超えた時は 400", () => {
    expect(interpretRpcResult(200, { ok: false, reason: "invalid_items" }, plan).status).toBe(400);
  });

  it("関数がまだ無い(SQLを流す前)時は、利用者の誤りにせず 503", () => {
    expect(interpretRpcResult(404, { code: "PGRST202" }, plan).status).toBe(503);
  });

  it("Supabase側の失敗や想定外の応答は 502", () => {
    expect(interpretRpcResult(500, null, plan).status).toBe(502);
    expect(interpretRpcResult(200, null, plan).status).toBe(502);
    expect(interpretRpcResult(200, "ok", plan).status).toBe(502);
  });
});

describe("Netlify版とVercel版のずれ", () => {
  const bodies: unknown[] = [
    okBody(),
    okBody({ code: "" }),
    okBody({ items: [] }),
    okBody({ items: [{ date: "2026-9-3", startTime: "9:00", endTime: "8:00", title: "x", type: "transport", endLocation: "y", amount: 1 }, { title: "a" }] }),
    { code: CODE, items: [{ date: "2026-02-30", title: "実在しない日" }] },
    null,
    "text",
  ];

  it("同じ入力から同じ結果を作る", () => {
    for (const body of bodies) expect(vercelParseReceivedPlan(body)).toEqual(parseReceivedPlan(body));
    expect(VERCEL_MAX_ITEMS).toBe(MAX_ITEMS);
    for (const value of ["LH-ab cd", undefined, 5]) expect(vercelNormalizeCode(value)).toBe(normalizeCode(value));
    for (const value of ["2026-9-3", "2026-02-30", "x"]) expect(vercelNormalizeDate(value)).toBe(normalizeDate(value));
    for (const value of ["9:00", "24:00", "x"]) expect(vercelNormalizeTime(value)).toBe(normalizeTime(value));
  });

  it("同じ応答から同じ返事を作る", () => {
    const plan = { code: "X", items: [{ date: "2026-12-27", title: "a", type: "other" as const }], skipped: 1 };
    const rpcs: [number, unknown][] = [
      [200, { ok: true }],
      [200, { ok: false, reason: "invalid_code" }],
      [200, { ok: false, reason: "invalid_items" }],
      [404, {}],
      [500, null],
    ];
    for (const [status, data] of rpcs) expect(vercelInterpretRpcResult(status, data, plan)).toEqual(interpretRpcResult(status, data, plan));
  });
});

/** 実際に Supabase へ送る内容と、返事の形を、Vercel版・Netlify版の両方で確かめる。 */
describe("受け口(handler)", () => {
  function stubSupabase(rpc: { status: number; body: unknown }) {
    const fetchMock = vi.fn(async () => ({ status: rpc.status, json: async () => rpc.body }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    return fetchMock;
  }

  async function callVercel(method: string, body: unknown) {
    let status = 0;
    let json: unknown;
    const res = {
      status(code: number) {
        status = code;
        return res;
      },
      json(value: unknown) {
        json = value;
        return res;
      },
    };
    await vercelHandler({ method, body } as never, res as never);
    return { status, json: json as Record<string, unknown> };
  }

  async function callNetlify(method: string, body: unknown) {
    const result = (await netlifyHandler({ httpMethod: method, body: JSON.stringify(body) } as never, {} as never)) as {
      statusCode: number;
      body: string;
    };
    return { status: result.statusCode, json: JSON.parse(result.body) as Record<string, unknown> };
  }

  for (const [name, call] of [["Vercel版", callVercel], ["Netlify版", callNetlify]] as const) {
    describe(name, () => {
      it("正規化したコードと検証済みの予定を、Supabase の関数へ渡す", async () => {
        const fetchMock = stubSupabase({ status: 200, body: { ok: true, received: 2 } });
        const reply = await call("POST", okBody({ items: [{ date: "2026-12-27", title: "昼食", amount: 3000 }] }));
        expect(reply.status).toBe(200);
        expect(reply.json).toMatchObject({ ok: true, received: 1 });

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://example.supabase.co/rest/v1/rpc/receive_chatgpt_trip");
        expect((init.headers as Record<string, string>).apikey).toBe("anon-key");
        const sent = JSON.parse(init.body as string);
        expect(sent).toMatchObject({ p_code: "LHABCDEFGHJKLMNPQRSTUV", p_trip_name: "四国旅行", p_start_date: "2026-12-27" });
        expect(sent.p_items).toEqual([{ date: "2026-12-27", title: "昼食", type: "other" }]);
        expect(JSON.stringify(sent)).not.toContain("3000");
      });

      it("コードが違えば 401、内容が駄目なら Supabase を呼ばずに 400", async () => {
        const fetchMock = stubSupabase({ status: 200, body: { ok: false, reason: "invalid_code" } });
        expect((await call("POST", okBody())).status).toBe(401);
        fetchMock.mockClear();
        expect((await call("POST", okBody({ items: [] }))).status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("POST 以外は断る。Supabase に届かなければ 502", async () => {
        stubSupabase({ status: 200, body: { ok: true } });
        expect((await call("GET", okBody())).status).toBe(405);
        vi.stubGlobal("fetch", vi.fn(async () => {
          throw new Error("network");
        }));
        expect((await call("POST", okBody())).status).toBe(502);
      });

      it("接続設定が無ければ 503", async () => {
        vi.stubGlobal("fetch", vi.fn());
        vi.stubEnv("VITE_SUPABASE_URL", "");
        vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
        expect((await call("POST", okBody())).status).toBe(503);
      });
    });
  }
});

/** ChatGPT に読み込ませる接続の定義(public/chatgpt/openapi.json)が、受け口と食い違っていないこと。 */
describe("専用GPT用の接続定義(openapi.json)", () => {
  const spec = JSON.parse(readFileSync(new URL("../../public/chatgpt/openapi.json", import.meta.url), "utf8"));
  const operation = spec.paths["/api/receiveTripPlan"].post;
  const body = operation.requestBody.content["application/json"].schema;

  it("受け口のパスと、GPTから呼ぶ名前を定義している", () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(operation.operationId).toBe("sendTripPlan");
    expect(spec.servers[0].url).toMatch(/^https:\/\//);
    // 送信ごとに確認を求められないようにする(旅程は受信箱に置くだけで、日程には入らないため)。
    expect(operation["x-openai-isConsequential"]).toBe(false);
  });

  it("必須の項目と件数の上限が、受け口の検証と同じ", () => {
    expect(body.required).toEqual(["code", "items"]);
    expect(body.properties.items.maxItems).toBe(MAX_ITEMS);
    expect(body.properties.items.items.required).toEqual(["date", "title"]);
  });

  it("予定の種類は、受け口が受け付けるものと同じ。金額の項目は持たない", () => {
    const itemProps = body.properties.items.items.properties;
    expect(itemProps.type.enum).toEqual(["transport", "lodging", "meal", "sightseeing", "other"]);
    for (const type of itemProps.type.enum) {
      const parsed = parseReceivedPlan({ code: "LHABCD", items: [{ date: "2026-12-27", title: "x", type }] });
      expect(parsed.ok && parsed.plan.items[0].type).toBe(type);
    }
    expect(Object.keys(itemProps)).not.toContain("amount");
  });

  it("GPTの設定画面の制限に収まる(操作の説明は300文字まで)", () => {
    expect(operation.description.length).toBeLessThanOrEqual(300);
    expect(operation.summary.length).toBeLessThanOrEqual(100);
  });
});

/**
 * プライバシーポリシーのページ(public/chatgpt/privacy.html)。専用GPTのアクションに登録する
 * (登録が無いと、GPTをリンクで共有できない)。ページに書いた事実が、実際の動作と食い違うと
 * 「書いてあることと違う」ポリシーになるので、数字や取り扱いはコード・SQLと突き合わせる。
 */
describe("プライバシーポリシーのページ", () => {
  const page = readFileSync(new URL("../../public/chatgpt/privacy.html", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../../supabase/sql/027_chatgpt_trip_inbox.sql", import.meta.url), "utf8");

  it("ページとして開ける(日本語・スマホ幅)。連絡先の仮の文字が残っていない", () => {
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain('<html lang="ja">');
    expect(page).toContain('name="viewport"');
    expect(page).not.toContain("__CONTACT");
    expect(page).toMatch(/href="mailto:[^"@\s]+@[^"@\s]+\.[a-z]+"/);
  });

  it("受信箱に残す件数・コードの保存のしかたが、SQLと同じ", () => {
    const keep = sql.match(/limit (\d+)\s*\)/)?.[1];
    expect(keep).toBe("20");
    expect(page).toContain(`最新の${keep}件まで`);
    // コードそのものは置かず、SHA-256 の値だけを置く。
    expect(sql).toContain("sha256(");
    expect(page).toContain("SHA-256");
  });

  it("金額を受け取らないこと・読めないものを書いている", () => {
    // 受け口は金額を捨てる(parseReceivedPlan のテストで確かめている)。
    const parsed = parseReceivedPlan({ code: "LHABCD", items: [{ date: "2026-12-27", title: "x", amount: 9000 }] });
    expect(parsed.ok && "amount" in parsed.plan.items[0]).toBe(false);
    expect(page).toContain("金額");
    expect(page).toContain("受け取らず、捨てます");
  });

  it("関わるサービス(ChatGPT・Vercel・Supabase)を書いている", () => {
    for (const name of ["ChatGPT", "OpenAI", "Vercel", "Supabase"]) expect(page, name).toContain(name);
  });
});
