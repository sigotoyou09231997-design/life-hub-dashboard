import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SCAN_CHUNKS, SCAN_CHUNK_CHARS, extractTripPlanFromSources, scanTripPlan, splitScanText } from "./tripPlanScan";
import { describePlanImportError } from "./mailPlanImport";

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

afterEach(() => vi.unstubAllGlobals());

describe("extractTripPlanFromSources", () => {
  it("文章・写真・旅行の期間をサーバーへ渡す", async () => {
    const fetchMock = mockFetch(200, { items: [] });
    await extractTripPlanFromSources({
      text: "  9/12 10:00 羽田発  ",
      images: [{ base64: "AAAA", mediaType: "image/jpeg" }],
      today: "2026-08-30",
      tripStart: "2026-09-12",
      tripEnd: "2026-09-14",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/extractTripPlan");
    const sent = JSON.parse(init.body as string);
    // 「2日目」を実際の日付に直すのに旅行の期間が要る。
    expect(sent).toMatchObject({
      text: "9/12 10:00 羽田発",
      images: [{ base64: "AAAA", mediaType: "image/jpeg" }],
      today: "2026-08-30",
      tripStart: "2026-09-12",
      tripEnd: "2026-09-14",
    });
  });

  it("写真だけ・文章だけでも渡せる(空の側は送らない)", async () => {
    const fetchMock = mockFetch(200, { items: [] });
    await extractTripPlanFromSources({ text: "   ", images: [{ base64: "AAAA", mediaType: "image/png" }], today: "2026-08-30" });
    const sent = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(sent.text).toBeUndefined();
    expect(sent.images).toHaveLength(1);
  });

  it("読み取れた日程をそのまま返す", async () => {
    mockFetch(200, { items: [{ date: "2026-09-12", title: "羽田→福岡", type: "transport" }] });
    const items = await extractTripPlanFromSources({ text: "本文", today: "2026-08-30" });
    expect(items).toEqual([{ date: "2026-09-12", title: "羽田→福岡", type: "transport" }]);
  });

  it("日程が無ければ空で返す(itemsが無い応答でも落ちない)", async () => {
    mockFetch(200, {});
    expect(await extractTripPlanFromSources({ text: "本文", today: "2026-08-30" })).toEqual([]);
  });

  it("サーバーの理由をそのままエラーにする", async () => {
    mockFetch(400, { error: "写真が大きすぎます。もう少し小さい写真でお試しください" });
    await expect(extractTripPlanFromSources({ text: "本文", today: "2026-08-30" })).rejects.toThrow("写真が大きすぎます");
  });

  it("ステータスを持たせる(案内の文言の出し分けに使う)", async () => {
    // 405は、端末のアプリだけ先に新しくなってサーバー側が未更新の時に返る。
    mockFetch(405, {});
    const error = await extractTripPlanFromSources({ text: "本文", today: "2026-08-30" }).catch((err) => err);
    expect((error as { status: number }).status).toBe(405);
    expect(describePlanImportError(error)).toContain("アプリを一度閉じて開き直して");
  });
});

/** 7日ぶんの旅程表に似せた文章を作る(2026-10-04に実際に切れた形: 日ごとの見出し、
 * 時刻を1行ずつ書いた欄、「↓」の経路図、雪の別案、末尾のまとめ)。 */
function dayBlock(heading: string, timedLines: number, tag = heading): string {
  const lines = Array.from({ length: timedLines }, (_, i) => `${String(6 + i).padStart(2, "0")}:00　散策${tag}-${i + 1}`);
  // 実物の1日は800字前後(経路図と雪の別案を含む)。2日ぶんで1回の目安を超える長さにする。
  const note = "路面の状況は出発前に必ず確認する。".repeat(25);
  return [heading, "＝＝＝＝", "【通常ルート】", "高松", "↓", "徳島", "", ...lines, "", "【雪・路面凍結ルート】", "高松", "↓", "徳島", note].join("\n");
}

function itinerary(days = 7, timedLines = 14): string {
  const preamble = ["【四国旅行】", "2026/12/27(日)〜2027/1/2(土)", "", "【レンタカー】", "12/27〜12/30", "12/31", "小豆島でレンタカー"].join("\n");
  const blocks = Array.from({ length: days }, (_, i) => dayBlock(`■12/${27 + i}(${"日月火水木金土"[i % 7]})`, timedLines, `D${27 + i}`));
  return [preamble, ...blocks, "■最重要", "12/28", "→ 祖谷を無理しない"].join("\n\n");
}

/** 時刻を1行ずつ書いた、見出しの無い欄(1行30字ほど)。 */
function longLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `${String(6 + (i % 14)).padStart(2, "0")}:30　散策${i}　おすすめの見どころをゆっくり回る`).join("\n");
}

describe("splitScanText", () => {
  it("空は空、短い文章は分けずに1つ", () => {
    expect(splitScanText("   ")).toEqual([]);
    expect(splitScanText("9/12 10:00 羽田発\n同日 15:00 チェックイン")).toEqual(["9/12 10:00 羽田発\n同日 15:00 チェックイン"]);
  });

  it("7日ぶんの旅程は、日の見出しで区切って1日ずつ別の回にする", () => {
    const text = itinerary();
    expect(text.length).toBeGreaterThan(SCAN_CHUNK_CHARS);
    const chunks = splitScanText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(7);
    // どの日も、その日の見出しから始まる回に、その日の予定が全部入っている(途中で切れていない)。
    for (let day = 27; day <= 33; day++) {
      const owner = chunks.filter((chunk) => chunk.includes(`散策D${day}-`));
      expect(owner).toHaveLength(1);
      expect(owner[0]).toContain(`■12/${day}(`);
      for (let i = 1; i <= 14; i++) expect(owner[0]).toContain(`${String(5 + i).padStart(2, "0")}:00　散策D${day}-${i}\n`);
    }
  });

  it("1回に詰める時刻付きの行は、サーバーの件数の上限に収まる数までにする", () => {
    // 字数は小さくても、1行がほぼ1件になる。短い日が2日重なって40件を超えないようにする。
    const chunks = splitScanText(itinerary(6, 20));
    for (const chunk of chunks) {
      const timed = chunk.split("\n").filter((line) => /\d{1,2}:\d{2}/.test(line)).length;
      expect(timed).toBeLessThanOrEqual(30);
    }
  });

  it("日の見出しの書き方はいろいろ読む", () => {
    const filler = longLines(40);
    for (const heading of ["【12/28】", "12/28(月)", "2026年12月28日(月)", "■2日目", "Day 2", "12/28（月）小金井→高松"]) {
      const text = `1日目\n${filler}\n\n${heading}\n${filler}`;
      const chunks = splitScanText(text);
      expect(chunks.length, heading).toBe(2);
      expect(chunks[1].startsWith(heading), heading).toBe(true);
    }
  });

  it("ChatGPTが付けがちなMarkdownの飾りがあっても、日の見出しとして読む", () => {
    // 「### 12/28(月)」「**12/28(月)**」のまま返ってくる。見出しと見なさないと、複数日が1回に
    // 詰まって、後ろの日が件数の上限で切れる。「#」は印そのものなので曜日が無くても見出し。
    const filler = longLines(40);
    for (const heading of ["### 12/28(月)", "## 2日目 12/28(月)", "**12/28(月)**", "**■12/28(月) 高松**", "### ■12/28(月)", "## 12/28"]) {
      const text = `1日目\n${filler}\n\n${heading}\n${filler}`;
      const chunks = splitScanText(text);
      expect(chunks.length, heading).toBe(2);
      expect(chunks[1].startsWith(heading), heading).toBe(true);
    }
  });

  it("日付の無いMarkdownの見出しや太字の行では区切らない", () => {
    const filler = longLines(40);
    for (const line of ["# 四国旅行のしおり", "**持ち物**", "- 12/28", "> 12/28"]) {
      const chunks = splitScanText(`1日目\n${filler}\n\n${line}\n${filler}`);
      expect(chunks, line).toHaveLength(1);
    }
  });

  it("予定そのものの行・期間・印も曜日も無い日付だけの行では区切らない", () => {
    // 「9/12 10:00 羽田発」は予定。「12/27〜12/30」は期間。基本情報に出てくる「12/31」だけの行も見出しではない。
    // 欄の途中で切ると、後ろ半分から日付が消えて読み取れなくなる。
    const text = ["9/12 10:00 羽田発", "12/27〜12/30", "12/31", "小豆島でレンタカー", longLines(60)].join("\n");
    // 分けるほど長い文章であることを先に確かめる(短いだけで1つになったのでは何も試せていない)。
    expect(text.length).toBeGreaterThan(SCAN_CHUNK_CHARS);
    expect(splitScanText(text)).toHaveLength(1);
  });

  it("見出しより前の基本情報は、入りきるなら最初の日と同じ回に入れる", () => {
    const text = ["【旅行】", "レンタカー: 12/27〜12/30", "", dayBlock("■12/27(日)", 8), "", dayBlock("■12/28(月)", 8), "", dayBlock("■12/29(火)", 8)].join("\n");
    const chunks = splitScanText(text);
    expect(chunks[0]).toContain("レンタカー");
    expect(chunks[0]).toContain("■12/27(日)");
  });

  it("見出しが1つも無い長い文章は、分けずに1回で読む(日付を失う切り方をしない)", () => {
    const text = Array.from({ length: 80 }, (_, i) => `9/12 ${String(6 + (i % 14)).padStart(2, "0")}:30 散策${i}`).join("\n");
    expect(text.length).toBeGreaterThan(SCAN_CHUNK_CHARS);
    expect(splitScanText(text)).toEqual([text]);
  });
});

describe("scanTripPlan", () => {
  /** リクエストの文章ごとに応答を決める fetch。 */
  function routedFetch(respond: (sent: { text?: string; images?: unknown[] }) => { status?: number; body?: unknown }) {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { status = 200, body = { items: [] } } = respond(JSON.parse(init.body as string));
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock as unknown as ReturnType<typeof vi.fn>;
  }

  /** 送られた文章に出てくる「■12/NN」の日を、1件の予定として返す。 */
  function echoDays(sent: { text?: string }) {
    const days = [...(sent.text ?? "").matchAll(/■12\/(\d+)\(/g)].map((match) => Number(match[1]));
    return {
      body: {
        items: days.map((day) => ({
          date: day <= 31 ? `2026-12-${day}` : `2027-01-${String(day - 31).padStart(2, "0")}`,
          startTime: "09:00",
          title: `${day}日の予定`,
          type: "sightseeing",
        })),
      },
    };
  }

  const input = { text: itinerary(), today: "2026-10-04", tripStart: "2026-12-27", tripEnd: "2027-01-02" };

  it("長い文章は日ごとに分けて読み、日付順の1つの一覧にして返す", async () => {
    const fetchMock = routedFetch(echoDays);
    const result = await scanTripPlan(input);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(result.notices).toEqual([]);
    // 7日ぶんが1日も欠けずに、日付の順に並ぶ(返ってきた順ではなく)。
    expect(result.items.map((item) => item.title)).toEqual(["27日の予定", "28日の予定", "29日の予定", "30日の予定", "31日の予定", "32日の予定", "33日の予定"]);
    // どの回にも旅行の期間を渡す(「2日目」を日付に直すのに要る)。
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(JSON.parse(init.body as string)).toMatchObject({ tripStart: "2026-12-27", tripEnd: "2027-01-02", today: "2026-10-04" });
    }
  });

  it("進み具合を伝える(0から全体の数まで)", async () => {
    routedFetch(echoDays);
    const progress = vi.fn();
    await scanTripPlan(input, progress);
    const total = progress.mock.calls[0][1] as number;
    expect(progress.mock.calls[0]).toEqual([0, total]);
    expect(progress.mock.calls.at(-1)).toEqual([total, total]);
  });

  it("一部の回が失敗しても、読めた分は残し、どこが読めていないかを断る", async () => {
    routedFetch((sent) => (sent.text?.includes("■12/29(") ? { status: 502, body: { error: "内容が多すぎて読み取りきれませんでした" } } : echoDays(sent)));
    const result = await scanTripPlan(input);
    expect(result.items.map((item) => item.title)).not.toContain("29日の予定");
    expect(result.items).toHaveLength(6);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toContain("■12/29(火)");
    expect(result.notices[0]).toContain("読み取れませんでした");
  });

  it("全部の回が失敗したら、サーバーの理由のままエラーにする", async () => {
    routedFetch(() => ({ status: 400, body: { error: "読み取るもとになる文章か写真が必要です" } }));
    const error = await scanTripPlan(input).catch((err) => err);
    expect(error.message).toContain("読み取るもとになる文章か写真が必要です");
    expect(error.status).toBe(400);
  });

  it("タイムアウト(504)は1回だけやり直す。内容が多すぎる(502)はやり直さない", async () => {
    let timeouts = 0;
    const fetchMock = routedFetch((sent) => {
      if (sent.text?.includes("■12/28(") && timeouts++ === 0) return { status: 504, body: {} };
      return echoDays(sent);
    });
    const callsBefore = fetchMock.mock.calls.length;
    const result = await scanTripPlan(input);
    expect(result.items.map((item) => item.title)).toContain("28日の予定");
    expect(result.notices).toEqual([]);
    const calls28 = fetchMock.mock.calls.slice(callsBefore).filter(([, init]) => (JSON.parse((init as RequestInit).body as string).text as string).includes("■12/28("));
    expect(calls28).toHaveLength(2);

    let tooMany = 0;
    routedFetch((sent) => {
      if (sent.text?.includes("■12/28(")) {
        tooMany++;
        return { status: 502, body: { error: "内容が多すぎて読み取りきれませんでした" } };
      }
      return echoDays(sent);
    });
    await scanTripPlan(input);
    expect(tooMany).toBe(1);
  });

  it("サーバーが件数の上限で切った回は、その部分を断る", async () => {
    routedFetch((sent) => (sent.text?.includes("■12/31(") ? { body: { ...echoDays(sent).body, truncated: true } } : echoDays(sent)));
    const result = await scanTripPlan(input);
    expect(result.items).toHaveLength(7);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toContain("■12/31(木)");
    expect(result.notices[0]).toContain("読み取りきれていません");
  });

  it("短い文章は1回だけ読む(今までどおり)。上限で切れていれば断る", async () => {
    const fetchMock = routedFetch(() => ({ body: { items: [{ date: "2026-09-12", title: "羽田→福岡", type: "transport" }], truncated: true } }));
    const result = await scanTripPlan({ text: "9/12 10:00 羽田発", today: "2026-08-30" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(1);
    expect(result.notices[0]).toContain("読み取りきれていません");
  });

  it("写真は文章とは別の1回にして、全部の回に付けて送らない", async () => {
    const fetchMock = routedFetch(echoDays);
    await scanTripPlan({ ...input, images: [{ base64: "AAAA", mediaType: "image/jpeg" }] });
    const sent = (fetchMock.mock.calls as [string, RequestInit][]).map(([, init]) => JSON.parse(init.body as string));
    expect(sent.filter((body) => body.images)).toHaveLength(1);
    expect(sent.filter((body) => body.images)[0].text).toBeUndefined();
  });

  it("分けすぎになる長さの文章は、読みに行く前に断る", async () => {
    const fetchMock = routedFetch(echoDays);
    const error = await scanTripPlan({ ...input, text: itinerary(MAX_SCAN_CHUNKS * 3, 14) }).catch((err) => err);
    expect(error.message).toContain("文章が長すぎます");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
