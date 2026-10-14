import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripRoutePlace, TripScheduleItem } from "../types";

const mocks = vi.hoisted(() => ({ token: "user-token" as string | null }));
vi.mock("./supabase", () => ({
  auth: { getSession: async () => ({ data: { session: mocks.token ? { access_token: mocks.token } : null } }) },
}));

import {
  MAX_PLACES,
  PlaceSuggestError,
  buildRemapLines,
  collectPlaces,
  defaultChoices,
  describeCost,
  estimateCostYen,
  hasRegion,
  requestPlaceSuggestions,
  sanitizeSuggestions,
} from "./placeSuggestions";

const item = (location: string | undefined, id = location ?? "x"): TripScheduleItem => ({ id, tripId: "t1", date: "2026-12-27", title: id, location, type: "sightseeing", createdAt: 1 });
const place = (address: string): TripRoutePlace => ({ id: address, tripId: "t1", name: address, address, sortOrder: 1, visited: false, createdAt: 1 });

beforeEach(() => {
  mocks.token = "user-token";
  vi.unstubAllGlobals();
});

describe("hasRegion(都道府県・市区郡が書いてあるか)", () => {
  it("県・都道府・市・区・郡が書いてあれば true", () => {
    for (const text of ["霊山寺 徳島県鳴門市", "高松市役所", "東京都千代田区", "北海道函館市", "京都府京都市", "小豆郡土庄町", "渋谷区"]) {
      expect(hasRegion(text), text).toBe(true);
    }
  });

  it("名前だけの場所は false。「京都駅」の「都」・「道の駅」の「道」だけでは当てない", () => {
    for (const text of ["霊山寺", "児島駅", "京都駅", "道の駅 うずしお", "南禅寺周辺", "四条のホテル", "市役所"]) {
      expect(hasRegion(text), text).toBe(false);
    }
  });
});

describe("collectPlaces(AI に渡す場所を集める)", () => {
  it("日程の場所とルートの住所から、名前だけの場所を重複なしで集める。住所つきの場所は手がかりに回す", () => {
    const result = collectPlaces(
      [item("霊山寺"), item("児島駅"), item("霊山寺", "again"), item("大麻比古神社 徳島県鳴門市"), item(undefined), item("  ")],
      [place("児島駅"), place("高松駅"), place("高松市役所")],
    );
    expect(result.places).toEqual(["霊山寺", "児島駅", "高松駅"]);
    expect(result.context).toEqual(["大麻比古神社 徳島県鳴門市", "高松市役所"]);
    expect(result.truncated).toBe(false);
  });

  it("表の区切り(矢印・改行)を含む場所や、長すぎる場所は外す(書き換えの表に入れられないため)", () => {
    const result = collectPlaces([item("東京→京都"), item("a\nb"), item("あ".repeat(100)), item("霊山寺")], []);
    expect(result.places).toEqual(["霊山寺"]);
  });

  it("多すぎる時は MAX_PLACES 件で切って truncated", () => {
    const many = Array.from({ length: MAX_PLACES + 3 }, (_, i) => item(`場所${i}`));
    const result = collectPlaces(many, []);
    expect(result.places).toHaveLength(MAX_PLACES);
    expect(result.truncated).toBe(true);
  });
});

describe("sanitizeSuggestions", () => {
  const raw = [
    { from: "霊山寺", candidates: [{ to: "霊山寺 徳島県鳴門市" }, { to: "霊山寺 奈良県奈良市" }], sure: false },
    { from: "知らない場所", candidates: [{ to: "知らない場所 東京都" }], sure: true },
    { from: "児島駅", candidates: [{ to: "岡山県の児島駅" }, { to: "児島駅" }], sure: true },
  ];

  it("頼んだ場所の、名前で始まる候補だけを残す(渡していない場所・言い換え・元と同じは捨てる)", () => {
    expect(sanitizeSuggestions(raw, ["霊山寺", "児島駅"])).toEqual([
      { from: "霊山寺", candidates: [{ to: "霊山寺 徳島県鳴門市" }, { to: "霊山寺 奈良県奈良市" }], sure: false },
    ]);
    expect(sanitizeSuggestions("壊れた", ["霊山寺"])).toEqual([]);
    expect(sanitizeSuggestions(undefined, ["霊山寺"])).toEqual([]);
  });
});

describe("requestPlaceSuggestions", () => {
  const input = { tripName: "四国旅行", destination: "四国", places: ["霊山寺"], context: [] };
  const stubFetch = (status: number, body: unknown) => {
    const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", spy);
    return spy;
  };

  it("ログインのトークンを付けて聞き、検証した提案と使ったトークン数を返す", async () => {
    const spy = stubFetch(200, { suggestions: [{ from: "霊山寺", candidates: [{ to: "霊山寺 徳島県鳴門市" }], sure: true }], truncated: false, usage: { inputTokens: 1500, outputTokens: 700 } });
    const result = await requestPlaceSuggestions(input);
    expect(result.suggestions[0].candidates[0].to).toBe("霊山寺 徳島県鳴門市");
    expect(result.usage).toEqual({ inputTokens: 1500, outputTokens: 700 });
    const [url, init] = spy.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe("/api/suggestPlaces");
    expect(init.headers.authorization).toBe("Bearer user-token");
  });

  it("ログインしていなければ、聞かずに止める", async () => {
    mocks.token = null;
    const spy = stubFetch(200, {});
    await expect(requestPlaceSuggestions(input)).rejects.toMatchObject({ status: 401 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("サーバーの失敗は、画面に出す言い方で投げる。AI の利用料金の残高切れは、原因が分かる文にする", async () => {
    stubFetch(400, { error: "Anthropic API error: Your credit balance is too low" });
    await expect(requestPlaceSuggestions(input)).rejects.toThrow(/利用料金の残高が足りない/);
    stubFetch(404, {});
    await expect(requestPlaceSuggestions(input)).rejects.toThrow("この環境ではまだ使えません");
    stubFetch(502, { error: "AIから提案を取得できませんでした。もう一度お試しください" });
    await expect(requestPlaceSuggestions(input)).rejects.toThrow("AIから提案を取得できませんでした");
    stubFetch(500, { error: "Anthropic API error: something" });
    await expect(requestPlaceSuggestions(input)).rejects.toThrow(/提案を取得できませんでした\(500\)/);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await expect(requestPlaceSuggestions(input)).rejects.toBeInstanceOf(PlaceSuggestError);
  });
});

describe("費用の目安・表の行", () => {
  it("使ったトークン数から円に直す(入力 $2・出力 $10 / 100万トークン、1ドル150円)。1円未満はそう言う", () => {
    expect(estimateCostYen({ inputTokens: 1500, outputTokens: 700 })).toBeCloseTo(((1500 * 2 + 700 * 10) / 1_000_000) * 150, 6);
    expect(describeCost({ inputTokens: 1500, outputTokens: 700 })).toBe("費用の目安: 約2円");
    expect(describeCost({ inputTokens: 100, outputTokens: 50 })).toBe("費用の目安: 1円未満");
    expect(describeCost(undefined)).toBe("");
  });

  it("初めは、旅行の流れで1つに決まる場所(sure)だけ最初の候補を選ぶ。迷う場所は選ばない。選んだものだけ表の行になる", () => {
    const suggestions = [
      { from: "霊山寺", candidates: [{ to: "霊山寺 徳島県鳴門市" }, { to: "霊山寺 奈良県奈良市" }], sure: false },
      { from: "児島駅", candidates: [{ to: "児島駅 岡山県倉敷市" }], sure: true },
    ];
    const choices = defaultChoices(suggestions);
    expect(choices).toEqual({ 霊山寺: null, 児島駅: 0 });
    expect(buildRemapLines(suggestions, choices)).toBe("児島駅 → 児島駅 岡山県倉敷市");
    expect(buildRemapLines(suggestions, { ...choices, 霊山寺: 0 })).toBe("霊山寺 → 霊山寺 徳島県鳴門市\n児島駅 → 児島駅 岡山県倉敷市");
    expect(buildRemapLines(suggestions, { 霊山寺: 5, 児島駅: null })).toBe("");
  });
});
