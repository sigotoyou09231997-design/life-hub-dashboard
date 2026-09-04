/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripExpenseCurrency } from "../types";
import {
  CURRENCIES,
  EMPTY_CURRENCY_DRAFT,
  HOME_CURRENCY,
  currenciesByExpenseId,
  currencyLabel,
  draftToYen,
  fetchRateToYen,
  formatOriginalAmount,
  isCurrencyDraftComplete,
  isRateFetchable,
  parseErApiResponse,
  parseRateResponse,
  readCachedRate,
  toYen,
  type TripExpenseCurrencyDraft,
} from "./currency";

const RATE_OK = { amount: 1, base: "EUR", date: "2026-09-03", rates: { JPY: 171.5 } };
/** 予備の提供元(open.er-api.com)の形。元の通貨が base ではなく base_code に入る。 */
const ER_API_OK = { result: "success", base_code: "EUR", rates: { JPY: 171.5 } };

function mockFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function draft(overrides: Partial<TripExpenseCurrencyDraft> = {}): TripExpenseCurrencyDraft {
  return { currency: "EUR", originalAmount: "45", rate: "171.5", manual: false, ...overrides };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseRateResponse", () => {
  it("1通貨あたりの円を取り出す", () => {
    expect(parseRateResponse(RATE_OK, "EUR")).toBe(171.5);
  });

  it("円のレートが入っていなければ undefined", () => {
    expect(parseRateResponse({ base: "EUR", rates: { USD: 1.1 } }, "EUR")).toBeUndefined();
    expect(parseRateResponse({}, "EUR")).toBeUndefined();
    expect(parseRateResponse(null, "EUR")).toBeUndefined();
  });

  it("0以下・数字でないレートは採らない", () => {
    expect(parseRateResponse({ base: "EUR", rates: { JPY: 0 } }, "EUR")).toBeUndefined();
    expect(parseRateResponse({ base: "EUR", rates: { JPY: "171.5" } }, "EUR")).toBeUndefined();
  });

  it("頼んだ通貨と違う応答は使わない(取り違えた換算をしないため)", () => {
    expect(parseRateResponse(RATE_OK, "USD")).toBeUndefined();
  });
});

describe("toYen", () => {
  it("現地通貨の金額とレートから円を出す(四捨五入)", () => {
    expect(toYen(45, 171.5)).toBe(7718);
    expect(toYen(1000, 0.1112)).toBe(111);
  });
});

describe("isRateFetchable / currencyLabel", () => {
  it("円は換算しない", () => {
    expect(isRateFetchable(HOME_CURRENCY)).toBe(false);
  });

  it("ECBが公表していない通貨は自動で取れない", () => {
    expect(isRateFetchable("TWD")).toBe(false);
    expect(isRateFetchable("EUR")).toBe(true);
  });

  it("通貨コードに日本語の名前を付ける", () => {
    expect(currencyLabel("EUR")).toBe("ユーロ");
    expect(currencyLabel("XXX")).toBe("XXX");
  });

  it("選べる通貨に円は入れない(換算する相手として選ぶものではない)", () => {
    expect(CURRENCIES.some((c) => c.code === HOME_CURRENCY)).toBe(false);
  });
});

describe("fetchRateToYen", () => {
  it("レートを引いて返す", async () => {
    mockFetch(RATE_OK);
    expect(await fetchRateToYen("EUR")).toBe(171.5);
  });

  it("いちど引いたら半日は覚えて、問い合わせ直さない", async () => {
    const fetchMock = mockFetch(RATE_OK);
    const now = Date.now();
    await fetchRateToYen("EUR", now);
    await fetchRateToYen("EUR", now + 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readCachedRate("EUR", now)).toBe(171.5);
  });

  it("半日を過ぎたら引き直す", async () => {
    const fetchMock = mockFetch(RATE_OK);
    const now = Date.now();
    await fetchRateToYen("EUR", now);
    await fetchRateToYen("EUR", now + 13 * 60 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("自動で取れない通貨は問い合わせない", async () => {
    const fetchMock = mockFetch(RATE_OK);
    expect(await fetchRateToYen("TWD")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("失敗しても投げない(手でレートを入れてもらう)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await fetchRateToYen("EUR", Date.now(), { retryDelayMs: 0 })).toBeUndefined();
  });

  it("失敗したレートは覚えない", async () => {
    mockFetch({ base: "EUR", rates: {} });
    expect(await fetchRateToYen("EUR")).toBeUndefined();
    expect(readCachedRate("EUR")).toBeUndefined();
  });

  it("1回こけただけでは諦めず、同じ提供元に引き直す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async (_url: string) =>
      fetchMock.mock.calls.length === 1
        ? ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)
        : ({ ok: true, json: async () => RATE_OK } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchRateToYen("EUR", Date.now(), { retryDelayMs: 0 })).toBe(171.5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 2回とも同じ提供元(最初のホスト)に引いている。
    expect(fetchMock.mock.calls.every((call) => String(call[0]).includes("api.frankfurter.app"))).toBe(true);
  });

  it("引き直しても駄目なら、次の提供元に回る", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("api.frankfurter.app")
        ? ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)
        : ({ ok: true, json: async () => RATE_OK } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchRateToYen("EUR", Date.now(), { retryDelayMs: 0 })).toBe(171.5);
    // 最初の提供元に2回(引き直しぶん)、そのあと次の提供元へ。
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain("api.frankfurter.dev");
  });

  it("直る見込みの無い失敗(404)は引き直さず、すぐ次の提供元へ回す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("frankfurter")
        ? ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response)
        : ({ ok: true, json: async () => ER_API_OK } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchRateToYen("EUR", Date.now(), { retryDelayMs: 0 })).toBe(171.5);
    // frankfurter の2ホストに1回ずつ(引き直さない)、そのあと予備の提供元。
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("どの提供元も駄目なら undefined(手入力に落ちる)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = mockFetch({}, false);
    expect(await fetchRateToYen("EUR", Date.now(), { retryDelayMs: 0 })).toBeUndefined();
    // ok:false は status を持たない(=0 扱い)ので引き直さず、3提供元を1回ずつ。
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("parseErApiResponse", () => {
  it("予備の提供元の形(base_code)からも1通貨あたりの円を取り出す", () => {
    expect(parseErApiResponse(ER_API_OK, "EUR")).toBe(171.5);
  });

  it("頼んだ通貨と違う応答は使わない", () => {
    expect(parseErApiResponse(ER_API_OK, "USD")).toBeUndefined();
  });

  it("提供元が失敗を返していれば使わない", () => {
    expect(parseErApiResponse({ ...ER_API_OK, result: "error" }, "EUR")).toBeUndefined();
  });

  it("円のレートが無い・数字でなければ undefined", () => {
    expect(parseErApiResponse({ result: "success", base_code: "EUR", rates: { USD: 1.1 } }, "EUR")).toBeUndefined();
    expect(parseErApiResponse(null, "EUR")).toBeUndefined();
  });
});

describe("下書きの判定", () => {
  it("通貨・金額・レートが揃っていれば換算できる", () => {
    expect(isCurrencyDraftComplete(draft())).toBe(true);
    expect(draftToYen(draft())).toBe(7718);
  });

  it("円のままなら換算しない(通貨の行を持たせない)", () => {
    expect(isCurrencyDraftComplete(EMPTY_CURRENCY_DRAFT)).toBe(false);
    expect(draftToYen(draft({ currency: HOME_CURRENCY }))).toBeUndefined();
  });

  it("金額かレートが空・0以下なら換算しない", () => {
    expect(isCurrencyDraftComplete(draft({ originalAmount: "" }))).toBe(false);
    expect(isCurrencyDraftComplete(draft({ rate: "" }))).toBe(false);
    expect(isCurrencyDraftComplete(draft({ originalAmount: "0" }))).toBe(false);
    expect(isCurrencyDraftComplete(draft({ rate: "-1" }))).toBe(false);
  });
});

describe("formatOriginalAmount", () => {
  it("通貨の記号つきで書く", () => {
    // 記号は環境の Intl 実装に任せるので、金額と通貨が入っていることだけ見る。
    const text = formatOriginalAmount(45, "EUR");
    expect(text).toMatch(/45/);
  });

  it("知らない通貨コードでも、Intlが受け取れる形ならそのまま任せる", () => {
    expect(formatOriginalAmount(45, "XYZ")).toMatch(/XYZ/);
  });

  it("Intlが受け取れない通貨コードでも落ちない", () => {
    // 3文字でないコードは Intl が RangeError を投げる。ここまで来るのは
    // 手で壊れた値が入った時だけだが、フォームごと落とさないようにしてある。
    expect(formatOriginalAmount(45, "ABCD")).toBe("45 ABCD");
  });
});

describe("currenciesByExpenseId", () => {
  it("支出idで引ける表にする", () => {
    const rows: TripExpenseCurrency[] = [
      { id: "c1", expenseId: "e1", currency: "EUR", originalAmount: 45, rate: 171.5, rateSource: "api", createdAt: 0 },
      { id: "c2", expenseId: "e2", currency: "USD", originalAmount: 20, rate: 150, rateSource: "manual", createdAt: 0 },
    ];
    const map = currenciesByExpenseId(rows);
    expect(map.get("e1")?.currency).toBe("EUR");
    expect(map.get("e3")).toBeUndefined();
  });
});
