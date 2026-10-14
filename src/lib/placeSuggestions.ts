import { auth } from "./supabase";
import type { TripRoutePlace, TripScheduleItem } from "../types";
import { endMapQueryFor, mapQueryFor } from "./scheduleDetails";

/**
 * 日程の「場所」に都道府県・市区町村を補う、AI の提案(2026-10-14。サーバー側は api/suggestPlaces.ts)。
 *
 * 名前だけの場所(「霊山寺」)は、地図で同じ名前の別の場所に置かれて、ルートが大きく遠回りになる。
 * AI が旅行の名前・行き先・ほかの場所から地域を読んで候補を出し、本人が選んだものだけを
 * 「場所をまとめて直す」の表(src/lib/tripLocationRemap.ts)に入れる。**勝手に書き換えない**。
 */

/** サーバー(api/suggestPlaces.ts)と同じ上限。 */
export const MAX_PLACES = 80;
export const MAX_CONTEXT = 30;
export const MAX_TEXT_CHARS = 80;
export const MAX_CANDIDATES = 3;

export interface PlaceCandidate {
  to: string;
}

export interface PlaceSuggestion {
  from: string;
  candidates: PlaceCandidate[];
  /** 旅行の流れから1つに決まる時だけ true。false は画面で「要確認」と出し、選ぶまで書き換えに入れない。 */
  sure: boolean;
}

export interface PlaceSuggestResult {
  suggestions: PlaceSuggestion[];
  truncated: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

/** 都道府県か市区郡が、もう書かれているか。「京都駅」の「都」のような一文字では当てず、まとまりで見る。 */
export function hasRegion(text: string): boolean {
  return /(北海道|東京都|京都府|大阪府|[^\s　]{1,3}県)/.test(text) || /[^\s　]{1,6}[市区郡]/.test(text);
}

/** 表(「元 → 新」)を壊す文字(改行・タブ・矢印)を空白に直す。サーバーの cleanText と同じ。 */
function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/→|=>|->/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface CollectedPlaces {
  /** 補ってほしい場所(都道府県・市区町村が無いもの)。日程の場所と、ルートの住所を、同じ文字なら1つにして。 */
  places: string[];
  /** 手がかり(すでに書いてある場所)。 */
  context: string[];
  /** 場所が多すぎて、先頭の MAX_PLACES 件だけにした。 */
  truncated: boolean;
}

/**
 * 日程の場所とルートの住所から、AI に渡す場所を集める。
 * 「場所をまとめて直す」は元の場所と**ぴったり同じ**文字だけを書き換えるので、そのまま表に入れられる文字だけを集める
 * (矢印・改行を含む場所は、表の区切りと見分けがつかず書き換えられないので外す)。
 */
export function collectPlaces(schedule: TripScheduleItem[], routePlaces: TripRoutePlace[]): CollectedPlaces {
  const seen = new Set<string>();
  const places: string[] = [];
  const context: string[] = [];
  let truncated = false;
  // 日程に住所が入っている場所は、地図には住所が渡る(mapQueryFor)ので、場所の名前は聞かない(住所のほうを手がかりに回す)。
  const all = [
    ...schedule.flatMap((item) => [item.address?.trim() ? mapQueryFor(item) : item.location, item.endAddress?.trim() ? endMapQueryFor(item) : item.type === "transport" ? item.endLocation : undefined]),
    ...routePlaces.map((place) => place.address),
  ];
  for (const raw of all) {
    const text = raw?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    if (text.length > MAX_TEXT_CHARS || cleanText(text) !== text) continue;
    if (hasRegion(text)) {
      if (context.length < MAX_CONTEXT) context.push(text);
    } else if (places.length < MAX_PLACES) {
      places.push(text);
    } else {
      truncated = true;
    }
  }
  return { places, context, truncated };
}

/** サーバーの返事を、画面に出す前にもう一度確かめる(渡した場所の名前で始まる候補だけを残す)。 */
export function sanitizeSuggestions(raw: unknown, asked: string[]): PlaceSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const askedSet = new Set(asked);
  const byFrom = new Map<string, PlaceSuggestion>();
  for (const item of raw) {
    const record = item as { from?: unknown; candidates?: unknown; sure?: unknown } | null;
    if (!record || typeof record.from !== "string" || !askedSet.has(record.from) || byFrom.has(record.from) || !Array.isArray(record.candidates)) continue;
    const from = record.from;
    const candidates: PlaceCandidate[] = [];
    for (const candidate of record.candidates) {
      const to = cleanText((candidate as { to?: unknown } | null)?.to);
      if (!to || to.length > MAX_TEXT_CHARS + 40 || !to.startsWith(from) || to.length <= from.length) continue;
      if (candidates.some((existing) => existing.to === to)) continue;
      candidates.push({ to });
      if (candidates.length >= MAX_CANDIDATES) break;
    }
    if (candidates.length > 0) byFrom.set(from, { from, candidates, sure: record.sure === true });
  }
  return asked.flatMap((place) => {
    const found = byFrom.get(place);
    return found ? [found] : [];
  });
}

export class PlaceSuggestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PlaceSuggestError";
  }
}

/** サーバーのエラーを、画面に出す言い方に直す。AI の利用料金の残高切れは、原因が分かるように言う。 */
function describeError(status: number, serverMessage: string | undefined): string {
  if (status === 401) return "ログインしてから使ってください";
  if (status === 404) return "この環境ではまだ使えません";
  if (serverMessage && /credit balance|billing|payment/i.test(serverMessage)) {
    return "AIの利用料金の残高が足りないようです。AIを使う機能が止まっています(Anthropic の請求を確認してください)";
  }
  return serverMessage && !/^Anthropic API error/.test(serverMessage) ? serverMessage : `提案を取得できませんでした(${status})。しばらくしてからもう一度お試しください`;
}

export interface PlaceSuggestInput {
  tripName: string;
  destination: string;
  places: string[];
  context: string[];
}

export async function requestPlaceSuggestions(input: PlaceSuggestInput): Promise<PlaceSuggestResult> {
  const token = (await auth.getSession()).data.session?.access_token;
  if (!token) throw new PlaceSuggestError("ログインしてから使ってください", 401);
  let res: Response;
  try {
    res = await fetch("/api/suggestPlaces", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
  } catch {
    throw new PlaceSuggestError("通信できませんでした。電波の良い所でもう一度お試しください");
  }
  const data = (await res.json().catch(() => null)) as (Partial<PlaceSuggestResult> & { error?: string }) | null;
  if (!res.ok) throw new PlaceSuggestError(describeError(res.status, data?.error), res.status);
  return {
    suggestions: sanitizeSuggestions(data?.suggestions, input.places),
    truncated: data?.truncated === true,
    usage: data?.usage,
  };
}

/** AI の単価(2026年10月時点の公開料金。SNSアプリの費用計算と同じ。変わったらここだけ直す)。 */
const INPUT_USD_PER_MILLION = 2;
const OUTPUT_USD_PER_MILLION = 10;
const USD_JPY = 150;

/** 使ったトークン数から、費用の目安(円)。 */
export function estimateCostYen(usage: { inputTokens: number; outputTokens: number }): number {
  return ((usage.inputTokens * INPUT_USD_PER_MILLION + usage.outputTokens * OUTPUT_USD_PER_MILLION) / 1_000_000) * USD_JPY;
}

/** 画面に出す費用の言い方。 */
export function describeCost(usage: { inputTokens: number; outputTokens: number } | undefined): string {
  if (!usage) return "";
  const yen = estimateCostYen(usage);
  return yen < 1 ? "費用の目安: 1円未満" : `費用の目安: 約${Math.round(yen)}円`;
}

/** 選んだ候補を、「場所をまとめて直す」の表の行(「元 → 新」)にする。選ばなかった場所は入れない。 */
export function buildRemapLines(suggestions: PlaceSuggestion[], choices: Record<string, number | null>): string {
  return suggestions
    .flatMap((suggestion) => {
      const index = choices[suggestion.from];
      const candidate = index == null ? undefined : suggestion.candidates[index];
      return candidate ? [`${suggestion.from} → ${candidate.to}`] : [];
    })
    .join("\n");
}

/** 初めに選んでおく候補。旅行の流れから1つに決まる場所(sure)だけ最初の候補を選び、迷う場所は本人が選ぶまで「変えない」。 */
export function defaultChoices(suggestions: PlaceSuggestion[]): Record<string, number | null> {
  return Object.fromEntries(suggestions.map((suggestion) => [suggestion.from, suggestion.sure ? 0 : null]));
}
