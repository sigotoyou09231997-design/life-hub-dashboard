/**
 * 海外旅行の支出を現地通貨で入れて、円に直す。
 *
 * レートは Frankfurter(https://frankfurter.app/)から取る。ECBの公表値が元で、
 * APIキーが要らず無料なので、天気と同じくブラウザから直に引ける。
 * 取りに行く先は1つではない — 詳しくは RATE_SOURCES。
 * **取ったレートは手で上書きできる** — カードの実際のレートは、その日の
 * 公表値とはたいてい違うため(2026-09-04の本人の指示)。
 *
 * **円の金額(TripExpense.amount)はこれまでどおり。** 現地通貨の金額とレートは
 * 別のテーブル(tripExpenseCurrencies)に置き、支出の行そのものには足さない —
 * trip_expenses は Supabase へ同期していて、列を足すと人が本番でSQLを流すまで
 * 同期が壊れるため。合計・予算の計算はどれも amount(円)を見たままでよい。
 */

import { db } from "../db/schema";
import type { TripExpenseCurrency } from "../types";

/** レートは1日1回しか更新されない(ECBの公表)ので、半日覚えておけば足りる。 */
const RATE_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_CACHE_PREFIX = "lifehub.fxRate.v1:";

/** 1回の問い合わせを待つ上限。返らないホストで入力を止めないため。 */
const REQUEST_TIMEOUT_MS = 7000;
/** 一時的な失敗のときに引き直す回数(1なら「もう1回だけ」)。 */
const RETRIES_PER_SOURCE = 1;
const RETRY_DELAY_MS = 400;

/** 円。この値のときは換算そのものを行わない。 */
export const HOME_CURRENCY = "JPY";

export interface CurrencyOption {
  code: string;
  label: string;
}

/**
 * 選べる通貨。Frankfurter が返せるのは ECB が公表している通貨だけなので、
 * ここに無いもの(台湾ドル・ベトナムドンなど)は自動では取れない。
 * その場合もレートを手で入れれば使える。
 */
export const CURRENCIES: CurrencyOption[] = [
  { code: "USD", label: "米ドル" },
  { code: "EUR", label: "ユーロ" },
  { code: "KRW", label: "韓国ウォン" },
  { code: "CNY", label: "中国元" },
  { code: "TWD", label: "台湾ドル" },
  { code: "HKD", label: "香港ドル" },
  { code: "THB", label: "タイバーツ" },
  { code: "SGD", label: "シンガポールドル" },
  { code: "MYR", label: "マレーシアリンギット" },
  { code: "PHP", label: "フィリピンペソ" },
  { code: "IDR", label: "インドネシアルピア" },
  { code: "INR", label: "インドルピー" },
  { code: "GBP", label: "英ポンド" },
  { code: "CHF", label: "スイスフラン" },
  { code: "AUD", label: "豪ドル" },
  { code: "NZD", label: "NZドル" },
  { code: "CAD", label: "カナダドル" },
  { code: "MXN", label: "メキシコペソ" },
  { code: "BRL", label: "ブラジルレアル" },
  { code: "TRY", label: "トルコリラ" },
  { code: "ZAR", label: "南アフリカランド" },
  { code: "SEK", label: "スウェーデンクローナ" },
  { code: "NOK", label: "ノルウェークローネ" },
  { code: "DKK", label: "デンマーククローネ" },
  { code: "PLN", label: "ポーランドズロチ" },
  { code: "CZK", label: "チェココルナ" },
  { code: "HUF", label: "ハンガリーフォリント" },
];

/** Frankfurter が返せない通貨。自動取得は空振りするので、画面側で断りを出す。 */
const UNSUPPORTED_BY_API = new Set(["TWD"]);

export function isRateFetchable(currency: string): boolean {
  return currency !== HOME_CURRENCY && !UNSUPPORTED_BY_API.has(currency);
}

export function currencyLabel(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.label ?? code;
}

/** 応答から「1通貨あたり何円か」を取り出す。取れなければ undefined。 */
export function parseRateResponse(json: unknown, currency: string): number | undefined {
  const rates = (json as { rates?: Record<string, unknown> } | null)?.rates;
  const rate = rates?.[HOME_CURRENCY];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return undefined;
  // 応答が別の通貨のものだったら使わない(取り違えた換算をするより出さない方がよい)。
  const base = (json as { base?: unknown } | null)?.base;
  if (typeof base === "string" && base !== currency) return undefined;
  return rate;
}

/**
 * 予備の為替API(open.er-api.com)の応答。Frankfurter と形が違い、
 * 元の通貨は `base` ではなく `base_code` に入る。
 */
export function parseErApiResponse(json: unknown, currency: string): number | undefined {
  const body = json as { result?: unknown; base_code?: unknown; rates?: Record<string, unknown> } | null;
  if (typeof body?.result === "string" && body.result !== "success") return undefined;
  const rate = body?.rates?.[HOME_CURRENCY];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return undefined;
  if (typeof body?.base_code === "string" && body.base_code !== currency) return undefined;
  return rate;
}

interface RateSource {
  name: string;
  url(currency: string): string;
  parse(json: unknown, currency: string): number | undefined;
}

/**
 * 上から順に試す。2026-09-04 の本番確認で api.frankfurter.app が 503 を返して
 * 手入力に落ちたため、同じ Frankfurter の別ホストと、別提供元(er-api)を後ろに足した。
 * どれも APIキーが要らず、ブラウザから直に引ける(CORS が開いている)。
 */
const RATE_SOURCES: RateSource[] = [
  {
    name: "frankfurter.app",
    url: (currency) => `https://api.frankfurter.app/latest?from=${encodeURIComponent(currency)}&to=${HOME_CURRENCY}`,
    parse: parseRateResponse,
  },
  {
    name: "frankfurter.dev",
    url: (currency) =>
      `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(currency)}&symbols=${HOME_CURRENCY}`,
    parse: parseRateResponse,
  },
  {
    name: "er-api",
    url: (currency) => `https://open.er-api.com/v6/latest/${encodeURIComponent(currency)}`,
    parse: parseErApiResponse,
  },
];

/**
 * もう一度引いて直る見込みがある失敗か。混雑(429)とサーバー側の不調(5xx)、
 * それと通信そのものの失敗だけを引き直す。404 や 400 は何度やっても同じ。
 */
function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 1つの提供元から引く。取れなければ undefined(投げない)。 */
async function fetchFromSource(source: RateSource, currency: string, retryDelayMs: number): Promise<number | undefined> {
  for (let attempt = 0; attempt <= RETRIES_PER_SOURCE; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(source.url(currency), { signal: controller.signal });
      if (!res.ok) {
        // 直る見込みが無い失敗なら、この提供元はここで諦めて次へ回す。
        if (!isTransientStatus(res.status)) return undefined;
        throw new Error(`rate failed (${res.status})`);
      }
      // 200 が返ったのに読めない応答は、引き直しても同じなので次の提供元へ回す。
      return source.parse(await res.json(), currency);
    } catch (error) {
      console.error(`[currency] ${source.name} failed (attempt ${attempt + 1}):`, error);
      if (attempt < RETRIES_PER_SOURCE && retryDelayMs > 0) await delay(retryDelayMs);
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
}

/** 現地通貨の金額とレートから円を出す。円は小数を持たないので四捨五入する。 */
export function toYen(originalAmount: number, rate: number): number {
  return Math.round(originalAmount * rate);
}

interface CachedRate {
  at: number;
  rate: number;
}

export function readCachedRate(currency: string, now: number = Date.now()): number | undefined {
  try {
    const raw = localStorage.getItem(`${RATE_CACHE_PREFIX}${currency}`);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CachedRate;
    if (!entry?.at || now - entry.at > RATE_TTL_MS) return undefined;
    return entry.rate;
  } catch {
    return undefined;
  }
}

function writeCachedRate(currency: string, rate: number, now: number): void {
  try {
    localStorage.setItem(`${RATE_CACHE_PREFIX}${currency}`, JSON.stringify({ at: now, rate } satisfies CachedRate));
  } catch {
    // 覚えられないだけ。その場の換算は効いている。
  }
}

/**
 * 1通貨あたりの円を取りに行く。取れなければ undefined を返す(投げない) —
 * その時は手でレートを入れてもらう形にして、入力そのものは止めない。
 *
 * 1回失敗しただけでは諦めない: 提供元ごとに1回引き直し、それでも駄目なら
 * 次の提供元へ回す(RATE_SOURCES)。retryDelayMs はテストから0にするため。
 */
export async function fetchRateToYen(
  currency: string,
  now: number = Date.now(),
  { retryDelayMs = RETRY_DELAY_MS }: { retryDelayMs?: number } = {},
): Promise<number | undefined> {
  if (!isRateFetchable(currency)) return undefined;

  const cached = readCachedRate(currency, now);
  if (cached != null) return cached;

  for (const source of RATE_SOURCES) {
    const rate = await fetchFromSource(source, currency, retryDelayMs);
    if (rate != null) {
      writeCachedRate(currency, rate, now);
      return rate;
    }
  }
  return undefined;
}

/** 「€45.00」。円は扱わない(円の支出には通貨の行が付かないため)。 */
export function formatOriginalAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ja-JP", { style: "currency", currency }).format(amount);
  } catch {
    // 知らない通貨コードでも落とさない。
    return `${amount.toLocaleString()} ${currency}`;
  }
}

/* --- 支出との結びつけ ------------------------------------------------------ */

/** 支出idごとの通貨の行。一覧で1件ずつ引かずに済むよう、まとめて表にする。 */
export function currenciesByExpenseId(rows: TripExpenseCurrency[]): Map<string, TripExpenseCurrency> {
  return new Map(rows.map((row) => [row.expenseId, row]));
}

export interface TripExpenseCurrencyDraft {
  currency: string;
  /** 現地通貨の金額。空文字は「まだ入れていない」。 */
  originalAmount: string;
  /** 1通貨あたりの円。空文字は「まだ入れていない」。 */
  rate: string;
  /** 自動で入れたレートを本人が書き換えたか。 */
  manual: boolean;
}

export const EMPTY_CURRENCY_DRAFT: TripExpenseCurrencyDraft = {
  currency: HOME_CURRENCY,
  originalAmount: "",
  rate: "",
  manual: false,
};

/** 下書きが換算できる形になっているか。 */
export function isCurrencyDraftComplete(draft: TripExpenseCurrencyDraft): boolean {
  if (!isCurrencyDraftStorable(draft)) return false;
  const rate = Number(draft.rate);
  return draft.rate !== "" && rate > 0;
}

/**
 * レートがまだ無くても、内訳として残しておく価値があるか
 * (＝現地通貨と金額までは入っている)。
 *
 * レートを取れなかった時は、円の金額を手で入れてもらって支出そのものは保存する。
 * 「€45 払った」という事実まで捨ててしまうと、次に開いた時に取り直す手がかりが
 * 無くなるため(2026-09-04の指示)。
 */
export function isCurrencyDraftStorable(draft: TripExpenseCurrencyDraft): boolean {
  if (draft.currency === HOME_CURRENCY) return false;
  return draft.originalAmount !== "" && Number(draft.originalAmount) > 0;
}

/**
 * この下書きは、開いた時にレートを取り直すべきか。
 *
 * 取り直すのは「まだ一度も入っていない」時だけ — 手で入れた値は上書きしない
 * (カードの実際のレートは公表値と違うことが多く、直したものが正しい)。
 */
export function needsRateRefetch(draft: TripExpenseCurrencyDraft): boolean {
  if (draft.currency === HOME_CURRENCY || draft.manual || draft.rate !== "") return false;
  return isRateFetchable(draft.currency);
}

/** 下書きから円の金額を出す。換算できない形なら undefined。 */
export function draftToYen(draft: TripExpenseCurrencyDraft): number | undefined {
  if (!isCurrencyDraftComplete(draft)) return undefined;
  return toYen(Number(draft.originalAmount), Number(draft.rate));
}

export async function loadCurrencyDraft(expenseId: string): Promise<TripExpenseCurrencyDraft> {
  const existing = await db.tripExpenseCurrencies.where("expenseId").equals(expenseId).first();
  if (!existing) return EMPTY_CURRENCY_DRAFT;
  return {
    currency: existing.currency,
    originalAmount: String(existing.originalAmount),
    // レートを取れないまま保存した行(exchangeRate は 0)は「未入力」として読み直す —
    // そうすると needsRateRefetch が拾って、開いた時に取り直せる。
    rate: existing.exchangeRate > 0 ? String(existing.exchangeRate) : "",
    manual: existing.rateSource === "manual",
  };
}

/** 1件の支出につき通貨の行は1つだけ持つ。円に戻したら行ごと消す。 */
export async function saveCurrencyDraft(expenseId: string, draft: TripExpenseCurrencyDraft): Promise<void> {
  const existing = await db.tripExpenseCurrencies.where("expenseId").equals(expenseId).first();

  if (!isCurrencyDraftStorable(draft)) {
    if (existing?.id) await db.tripExpenseCurrencies.delete(existing.id);
    return;
  }

  const rate = draft.rate === "" ? 0 : Number(draft.rate);
  const next = {
    expenseId,
    currency: draft.currency,
    originalAmount: Number(draft.originalAmount),
    exchangeRate: rate > 0 ? rate : 0,
    rateSource: draft.manual ? ("manual" as const) : rate > 0 ? ("api" as const) : ("pending" as const),
  };

  if (existing?.id) {
    await db.tripExpenseCurrencies.update(existing.id, next);
  } else {
    await db.tripExpenseCurrencies.add({ ...next, createdAt: Date.now() });
  }
}

export async function deleteCurrencyFor(expenseId: string): Promise<void> {
  await db.tripExpenseCurrencies.where("expenseId").equals(expenseId).delete();
}
