import { afterEach, describe, expect, it, vi } from "vitest";
import { extractTripPlanFromSources } from "./tripPlanScan";
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
