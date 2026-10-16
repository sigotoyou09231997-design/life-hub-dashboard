import { addDays, addHours, parseISO } from "date-fns";
import { db } from "../db/schema";
import type { CalendarEvent, GmailAccount, GoogleCalendarLink, RepeatRule } from "../types";
import { toDateStr } from "./date";
import { normalizeEndDate } from "./eventSpan";
import { ensureFreshAccessToken, GOOGLE_CALENDAR_SCOPE, htmlToText } from "./gmail";
import { makeWeekdayRepeat, parseWeekdayRepeat } from "./repeatRule";

/**
 * Googleカレンダーとの連携(依頼「Googleカレンダーと双方向で同期したい」)。
 *
 * - 第1段(2026-09-16) = Google → LIFE HUB の取り込み。
 * - 第2段(2026-10-16) = LIFE HUB → Google の書き出し。supabase/sql/026(google_calendar_links)が本番に入り、
 *   取り込みの対応表が端末間で揃うようになってから足した。対応表が揃っていないと、ほかの端末が
 *   Googleから来た予定を「LIFE HUBで足した予定」と取り違えて書き出し、Google側に2件できるため。
 *
 * - 対象はメインのカレンダー(primary)1つ
 * - 連携を始めた時点で Google の syncToken(起点)だけ取り、その後に足した・変えた・消した
 *   予定だけを取り込む。すでにある予定はどちらの側も触らない、という依頼のとおり。
 *   書き出しも同じで、入にした後に足した・変えた予定だけを送る
 * - 取り込んだ予定のidは、アドレスとGoogle側のidから毎回同じ値を作る(stableUuid)。
 *   PCとスマホの両方で取り込んでも、calendar_events の同期で同じ行に重なり、2件にならない
 * - 書き出す予定のGoogle側のidは、LIFE HUBの予定のid(UUID)からハイフンを抜いた32文字にする
 *   (Google側のidは 0-9a-v で指定できる)。PCとスマホが同じ予定を同時に送っても、Google側で
 *   同じidに重なり(2件目は 409 で返る)、2件にならない。取り込み直す時もその形から元の予定を引ける
 * - 取り込みも書き出しも端末で行う(Gmailの同期と同じく、その端末で連携したトークンを使う)。
 *   書き出しのきっかけは、取り込みと同じ機会(画面を開いた時・今すぐ同期・引っ張って更新)に加えて、
 *   予定を足した・変えた・消した数秒後(src/lib/googleCalendarExportWatch.ts)
 */

export { GOOGLE_CALENDAR_SCOPE };

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary";
/** 画面を開いた時の自動の取り込みを見送る間隔。予定はメールほど頻繁には変わらない。 */
export const CALENDAR_AUTO_SYNC_COOLDOWN_MS = 10 * 60 * 1000;
/** 起点・変更分の取得でたどるページの上限(1ページ2500件)。 */
const MAX_PAGES = 40;
/** 1回の書き出しで Google に送る操作の上限。まとめて大量に送って利用制限に当たらないように。残りは次の回で送る。 */
export const MAX_EXPORT_OPS_PER_RUN = 100;

/** 表せない繰り返しを初回だけ入れた時に、メモの末尾へ添える一文。 */
export const UNSUPPORTED_REPEAT_NOTE =
  "(Googleカレンダーでは繰り返しの予定ですが、LIFE HUBでは表せない繰り返し方のため、初回だけ入れています)";

export function hasCalendarScope(account: Pick<GmailAccount, "grantedScopes">): boolean {
  return (account.grantedScopes ?? "").split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE);
}

export function isCalendarSyncEnabled(account: Pick<GmailAccount, "calendarSyncEnabledAt">): boolean {
  return Boolean(account.calendarSyncEnabledAt);
}

/** 同期を走らせてよいアカウントか(入にしてある・権限がある・連携が切れていない)。 */
export function isCalendarSyncReady(account: GmailAccount): boolean {
  return isCalendarSyncEnabled(account) && hasCalendarScope(account) && !account.reauthRequiredAt;
}

/** Google Calendar API の予定1件(使う項目だけ)。 */
export interface GoogleCalendarItem {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[];
  /** 繰り返し予定の「その回だけ」変えたもの・消したものに付く。 */
  recurringEventId?: string;
  created?: string;
  updated?: string;
}

/** seed から、UUIDの形をした毎回同じ値を作る(SHA-256の先頭16バイト)。
 * calendar_events.id は uuid 型なので、形が崩れていると同期で弾かれる。 */
export async function stableUuid(seed: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function importedEventId(accountEmail: string, googleEventId: string): Promise<string> {
  return stableUuid(`google-calendar:event:${accountEmail.toLowerCase()}:${googleEventId}`);
}

export function importedLinkId(accountEmail: string, googleEventId: string): Promise<string> {
  return stableUuid(`google-calendar:link:${accountEmail.toLowerCase()}:${googleEventId}`);
}

/**
 * LIFE HUB で足した予定を Google に書き出す時の、Google側のid。
 * 予定のid(UUID)からハイフンを抜いた32文字。Google側のidに使える文字(0-9a-v、5〜1024文字)に収まる。
 * 毎回同じ値なので、PCとスマホが同時に送っても Google側で同じ1件に重なる。
 */
export function googleEventIdFor(eventId: string): string {
  return eventId.replace(/-/g, "").toLowerCase();
}

/** googleEventIdFor の逆。LIFE HUB が付けた形(16進32文字)でなければ null(Googleが付けたidは 26文字で 0-9a-v)。 */
export function eventIdFromGoogleId(googleEventId: string): string | null {
  if (!/^[0-9a-f]{32}$/.test(googleEventId)) return null;
  const h = googleEventId;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const RRULE_WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * Google の RRULE を LIFE HUB の繰り返し(RepeatRule)に置き換える。
 * 表せない形(隔週・回数指定・毎年・第2月曜 など)は null。繰り返さない予定は "none"。
 *
 * 繰り返しの中の1回だけを消した・変えた(EXDATE や別の予定としての例外)は表せないので、
 * 元の繰り返しどおりに出る。
 */
export function parseRecurrence(
  recurrence: string[] | undefined,
  startDate: string,
): { repeat: RepeatRule; repeatUntil?: string } | null {
  const rule = recurrence?.find((line) => line.startsWith("RRULE:"));
  if (!rule) return { repeat: "none" };
  const parts: Record<string, string> = {};
  for (const pair of rule.slice("RRULE:".length).split(";")) {
    const [key, value] = pair.split("=");
    if (key && value !== undefined) parts[key.toUpperCase()] = value;
  }
  if ((parts.INTERVAL && parts.INTERVAL !== "1") || parts.COUNT || parts.BYSETPOS) return null;

  let repeatUntil: string | undefined;
  if (parts.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(parts.UNTIL);
    if (!m) return null;
    repeatUntil =
      m[4] && m[7]
        ? toDateStr(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])))
        : `${m[1]}-${m[2]}-${m[3]}`;
  }

  const weekdays = parts.BYDAY?.split(",").map((code) => RRULE_WEEKDAYS.indexOf(code));
  // 「1MO」(第1月曜)のような順番つきの指定は表せない。
  if (weekdays?.some((day) => day < 0)) return null;
  const startWeekday = parseISO(startDate).getDay();

  switch (parts.FREQ) {
    case "DAILY":
      return { repeat: weekdays ? makeWeekdayRepeat(weekdays) : "daily", repeatUntil };
    case "WEEKLY":
      if (!weekdays || (weekdays.length === 1 && weekdays[0] === startWeekday)) return { repeat: "weekly", repeatUntil };
      return { repeat: makeWeekdayRepeat(weekdays), repeatUntil };
    case "MONTHLY":
      if (weekdays) return null;
      if (parts.BYMONTHDAY && Number(parts.BYMONTHDAY) !== Number(startDate.slice(8, 10))) return null;
      return { repeat: "monthly", repeatUntil };
    default:
      return null;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** RFC3339 の日時を、この端末の時刻の日付と時刻に。アプリは端末の時刻のまま予定を持つ。 */
function localDateTime(value: string | undefined): { date: string; time: string } | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return { date: toDateStr(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export type GoogleImportResult =
  | { kind: "upsert"; event: CalendarEvent }
  | { kind: "delete" }
  | { kind: "skip"; reason: string };

/**
 * Googleの予定1件を、LIFE HUBの予定にする。
 *
 * すでに取り込んである予定を上書きする時は、LIFE HUBの側だけにある項目(誰の予定か・
 * 通知・カテゴリ・ほかのアカウントとの印)は残す。Googleの側に無い情報なので、
 * 上書きで消すと、付けた人の手間が次の変更のたびに消える。
 */
export function fromGoogleEvent(
  item: GoogleCalendarItem,
  existing: CalendarEvent | undefined,
  now: number,
): GoogleImportResult {
  if (item.status === "cancelled") return { kind: "delete" };
  // 繰り返しの1回だけを変えたもの。元の繰り返しとは別の予定として届くが、LIFE HUBでは
  // 「その回だけ外す」ができず、入れると同じ日に2件並ぶので入れない。
  if (item.recurringEventId) return { kind: "skip", reason: "繰り返しの1回だけの変更" };

  let date: string;
  let endDate: string | undefined;
  let startTime: string | undefined;
  let endTime: string | undefined;
  let allDay: boolean;

  if (item.start?.date) {
    allDay = true;
    date = item.start.date;
    // Googleの終日予定の終わりは「その日を含まない」。LIFE HUBは含む日で持つ。
    const lastDay = item.end?.date ? toDateStr(addDays(parseISO(item.end.date), -1)) : undefined;
    endDate = normalizeEndDate(date, lastDay);
  } else {
    const start = localDateTime(item.start?.dateTime);
    if (!start) return { kind: "skip", reason: "日時が読めない" };
    const end = localDateTime(item.end?.dateTime);
    allDay = false;
    date = start.date;
    startTime = start.time;
    if (end && end.time === "00:00" && end.date === toDateStr(addDays(parseISO(start.date), 1))) {
      // 22:00〜翌0:00 のように日付をまたいで0時ちょうどに終わるものは、その日の予定として扱う。
      endTime = "23:59";
    } else {
      endTime = end?.time;
      endDate = normalizeEndDate(date, end?.date);
    }
  }

  const recurrence = parseRecurrence(item.recurrence, date);
  const description = item.description?.includes("<") ? htmlToText(item.description) : item.description;
  const memo = [description?.trim(), recurrence ? "" : UNSUPPORTED_REPEAT_NOTE].filter(Boolean).join("\n");
  const moved = existing && (existing.date !== date || existing.startTime !== startTime);

  return {
    kind: "upsert",
    event: {
      ...existing,
      title: item.summary?.trim() || "(タイトルなし)",
      date,
      endDate,
      allDay,
      startTime,
      endTime,
      location: item.location?.trim() || undefined,
      memo: memo || undefined,
      category: existing?.category ?? "other",
      repeat: recurrence?.repeat ?? "none",
      repeatUntil: recurrence?.repeatUntil,
      // 日時が動いたら、もう一度通知できるように「通知済み」を下ろす。
      notifiedAt: moved ? undefined : existing?.notifiedAt,
      createdAt: existing?.createdAt ?? (Date.parse(item.created ?? "") || now),
      updatedAt: now,
    },
  };
}

// ---------------------------------------------------------------------------
// 書き出し(LIFE HUB → Google)
// ---------------------------------------------------------------------------

/** Google に送る予定の中身(insert / patch の body)。patch では null にした項目が消える。 */
export interface GoogleEventBody {
  id?: string;
  status: "confirmed";
  summary: string;
  description: string;
  location: string;
  start: { date?: string | null; dateTime?: string | null; timeZone?: string | null };
  end: { date?: string | null; dateTime?: string | null; timeZone?: string | null };
  recurrence: string[];
}

/** この端末の時間帯(Asia/Tokyo など)。Google には「端末の時刻＋時間帯」で送り、時差は Google 側が扱う。 */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function formatUtcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/**
 * LIFE HUB の繰り返しを Google の RRULE にする。繰り返さない予定は空の配列(patch で繰り返しを消す)。
 * 終わりの日(repeatUntil)は、時刻つきの予定では「その日の端末の時刻の 23:59:59」を UTC にして付ける
 * (RFC5545 では、開始が日時なら UNTIL も UTC の日時でなければならない)。終日の予定は日付のまま。
 */
export function toRecurrence(event: Pick<CalendarEvent, "repeat" | "repeatUntil" | "allDay" | "startTime">): string[] {
  const repeat = event.repeat;
  if (!repeat || repeat === "none") return [];
  const weekdays = parseWeekdayRepeat(repeat);
  let rule: string;
  if (weekdays) rule = `FREQ=WEEKLY;BYDAY=${weekdays.map((d) => RRULE_WEEKDAYS[d]).join(",")}`;
  else if (repeat === "daily") rule = "FREQ=DAILY";
  else if (repeat === "weekly") rule = "FREQ=WEEKLY";
  else if (repeat === "monthly") rule = "FREQ=MONTHLY";
  else return [];
  if (event.repeatUntil && /^\d{4}-\d{2}-\d{2}$/.test(event.repeatUntil)) {
    const timed = !event.allDay && Boolean(event.startTime);
    const until = timed ? formatUtcStamp(new Date(`${event.repeatUntil}T23:59:59`)) : event.repeatUntil.replace(/-/g, "");
    rule += `;UNTIL=${until}`;
  }
  return [`RRULE:${rule}`];
}

/**
 * LIFE HUB の予定1件を、Google に送る形にする。
 * - 終日(または時刻の無い予定)は日付で。Googleの終日の終わりは「その日を含まない」ので翌日にする
 * - 時刻つきは「端末の時刻＋時間帯」。終わりの時刻が無ければ1時間の予定として送る(Googleは終わりが必須)
 * - 取り込みで付けた「表せない繰り返し」の注記は、Google側には送らない(Google側にはもとの繰り返しがある)
 */
export function toGoogleEvent(event: CalendarEvent, timeZone: string): GoogleEventBody {
  const memo = (event.memo ?? "").replace(UNSUPPORTED_REPEAT_NOTE, "").trim();
  const body: GoogleEventBody = {
    status: "confirmed",
    summary: event.title?.trim() || "(タイトルなし)",
    description: memo,
    location: event.location?.trim() ?? "",
    start: {},
    end: {},
    recurrence: toRecurrence(event),
  };
  const lastDay = event.endDate && event.endDate > event.date ? event.endDate : event.date;
  if (event.allDay || !event.startTime) {
    body.start = { date: event.date, dateTime: null, timeZone: null };
    body.end = { date: toDateStr(addDays(parseISO(lastDay), 1)), dateTime: null, timeZone: null };
    return body;
  }
  const start = `${event.date}T${event.startTime}:00`;
  let end: string;
  if (event.endTime) {
    end = `${lastDay}T${event.endTime}:00`;
    // 終わりが始まりより前(入力の食い違い)なら、Google に弾かれないよう始まりと同じ時刻にする。
    if (end < start) end = start;
  } else {
    const d = addHours(new Date(start), 1);
    end = `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  }
  body.start = { dateTime: start, timeZone, date: null };
  body.end = { dateTime: end, timeZone, date: null };
  return body;
}

export interface ExportPlan {
  /** Google にまだ無い予定(入にした後に足した・変えた予定)。 */
  create: CalendarEvent[];
  /** Google にあり、前回の同期より後に LIFE HUB で変えた予定。 */
  update: { event: CalendarEvent; link: GoogleCalendarLink }[];
  /** LIFE HUB で消した予定(対応表だけ残っている)。Google からも消す。 */
  remove: GoogleCalendarLink[];
}

/** 予定の「LIFE HUB で最後に変えた時刻」。古い行は updatedAt が無いので作った時刻で代える。 */
function changedAt(event: CalendarEvent): number {
  return event.updatedAt ?? event.createdAt ?? 0;
}

/**
 * どの予定を Google へ送るかを決める(通信しない)。
 *
 * - 対応表がある予定: 対応表の時刻(最後に同期した時刻)より後に LIFE HUB で変えていれば更新。予定が無ければ Google からも消す
 * - 対応表が無い予定: 入にした後に足した・変えた予定だけ新しく作る。入にする前からある予定は触らない(依頼のとおり)。
 *   Google から取り込んだ予定には必ず対応表があるので、ここには来ない
 */
export function planExport(
  events: CalendarEvent[],
  links: GoogleCalendarLink[],
  accountEmail: string,
  enabledAt: number,
): ExportPlan {
  const plan: ExportPlan = { create: [], update: [], remove: [] };
  const email = accountEmail.toLowerCase();
  const byEventId = new Map<string, CalendarEvent>();
  for (const event of events) if (event.id) byEventId.set(event.id, event);
  const linked = new Set<string>();
  for (const link of links) {
    if (link.accountEmail.toLowerCase() !== email) continue;
    linked.add(link.eventId);
    const event = byEventId.get(link.eventId);
    if (!event) plan.remove.push(link);
    else if (changedAt(event) > (link.updatedAt ?? link.createdAt ?? 0)) plan.update.push({ event, link });
  }
  for (const event of events) {
    if (!event.id || linked.has(event.id)) continue;
    if (event.createdAt >= enabledAt || (event.updatedAt ?? 0) >= enabledAt) plan.create.push(event);
  }
  return plan;
}

export class GoogleCalendarError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Google Calendar API error (${status}): ${body}`);
    this.status = status;
    this.body = body;
  }
}

async function calendarFetch(accessToken: string, query: URLSearchParams): Promise<any> {
  const res = await fetch(`${CALENDAR_API_BASE}/events?${query.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.ok) return res.json();
  throw new GoogleCalendarError(res.status, await res.text().catch(() => ""));
}

/** 書き出しの1回の呼び出し(POST / PATCH / DELETE)。DELETE は中身が無い。 */
async function calendarWrite(
  accessToken: string,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: GoogleEventBody,
): Promise<GoogleCalendarItem | null> {
  const res = await fetch(`${CALENDAR_API_BASE}/events${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new GoogleCalendarError(res.status, await res.text().catch(() => ""));
  if (method === "DELETE" || res.status === 204) return null;
  return (await res.json()) as GoogleCalendarItem;
}

/** 起点の syncToken だけを取る。予定そのものは受け取らない(fields で落とす)。 */
async function fetchBaselineToken(accessToken: string): Promise<string> {
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ maxResults: "2500", showDeleted: "true", fields: "nextPageToken,nextSyncToken" });
    if (pageToken) query.set("pageToken", pageToken);
    const data = (await calendarFetch(accessToken, query)) as { nextPageToken?: string; nextSyncToken?: string };
    if (data.nextSyncToken) return data.nextSyncToken;
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  throw new Error("Googleカレンダーの起点を取得できませんでした");
}

/** 前回の syncToken から変わった予定と、次の syncToken。 */
async function fetchChanges(accessToken: string, syncToken: string): Promise<{ items: GoogleCalendarItem[]; nextSyncToken: string }> {
  const items: GoogleCalendarItem[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ maxResults: "2500", showDeleted: "true", syncToken });
    if (pageToken) query.set("pageToken", pageToken);
    const data = (await calendarFetch(accessToken, query)) as {
      items?: GoogleCalendarItem[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    items.push(...(data.items ?? []));
    if (data.nextSyncToken) return { items, nextSyncToken: data.nextSyncToken };
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  throw new Error("Googleカレンダーの変更を最後まで取得できませんでした");
}

/** 同期の失敗を、次にやることまで含めた日本語にする。 */
export function describeCalendarError(err: unknown): { message: string; needsReconnect: boolean } {
  const raw = err instanceof Error ? err.message : String(err);
  if (/rateLimitExceeded|userRateLimitExceeded|quotaExceeded|\b429\b/i.test(raw)) {
    return { message: "Googleカレンダーの利用制限に達しました。しばらく待つと、次に開いた時にまた同期します", needsReconnect: false };
  }
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(raw)) {
    return {
      message:
        "Google Cloud で Google Calendar API が有効になっていません。Google Cloud Console の「APIとサービス」→「ライブラリ」で Google Calendar API を有効にしてください",
      needsReconnect: false,
    };
  }
  if (/insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT|\(403\)/i.test(raw)) {
    return { message: "カレンダーを読み書きする権限がありません。「つなぎ直してカレンダーも許可する」からやり直してください", needsReconnect: true };
  }
  if (/invalid_grant|revoked|\(401\)/i.test(raw)) {
    return { message: "Googleとの連携が切れています。つなぎ直してください", needsReconnect: true };
  }
  return { message: `Googleカレンダーとの同期に失敗しました: ${raw}`, needsReconnect: false };
}

export interface CalendarSyncResult {
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
  /** LIFE HUB → Google へ送った件数(作った＋更新した)。 */
  exported: number;
  /** LIFE HUB で消したので Google からも消した件数。 */
  removed: number;
  /** 起点を取り直しただけで、予定は取り込んでいない(連携を始めた直後・起点が古くなった時)。 */
  baselined: boolean;
  error: string | null;
}

export const EMPTY_CALENDAR_SYNC_RESULT: CalendarSyncResult = {
  added: 0,
  updated: 0,
  deleted: 0,
  skipped: 0,
  exported: 0,
  removed: 0,
  baselined: false,
  error: null,
};

/** 何か起きたか(取り込み・書き出し・失敗のどれか)。「変更なし」を知らせない判定に使う。 */
export function calendarSyncChangedSomething(result: CalendarSyncResult): boolean {
  return Boolean(result.error || result.baselined || result.added || result.updated || result.deleted || result.exported || result.removed);
}

/** 同期結果をトースト1行に。 */
export function summarizeCalendarSync(result: CalendarSyncResult): string {
  if (result.error) return result.error;
  if (result.baselined) return "Googleカレンダーとつなぎました。これから足した・変えた予定を揃えます";
  const pulled = [
    result.added ? `${result.added}件追加` : "",
    result.updated ? `${result.updated}件更新` : "",
    result.deleted ? `${result.deleted}件削除` : "",
  ].filter(Boolean);
  const pushed = [result.exported ? `${result.exported}件送信` : "", result.removed ? `${result.removed}件削除` : ""].filter(Boolean);
  const parts = [
    pulled.length > 0 ? `Googleカレンダーから${pulled.join("・")}` : "",
    pushed.length > 0 ? `Googleカレンダーへ${pushed.join("・")}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join("、")}しました` : "Googleカレンダーとの間に新しい変更はありませんでした";
}

export interface CalendarSyncOptions {
  /** false なら Google からの取り込みを飛ばし、LIFE HUB → Google の書き出しだけ(予定を変えた直後に呼ぶ)。 */
  pull?: boolean;
}

/** 同じアカウントの同期を二重に走らせない(ホームと予定の画面が同時に呼ぶことがある)。 */
const inFlight = new Map<string, { run: Promise<CalendarSyncResult>; pull: boolean }>();

export function syncGoogleCalendar(account: GmailAccount, options: CalendarSyncOptions = {}): Promise<CalendarSyncResult> {
  if (!account.id) return Promise.resolve({ ...EMPTY_CALENDAR_SYNC_RESULT });
  const pull = options.pull !== false;
  const running = inFlight.get(account.id);
  if (running) {
    // 同じ取り込みが走っていれば相乗り。そうでなければ(書き出しだけが走っている最中の取り込み、
    // 取り込みの最中に予定を変えた、など)、終わってからもう一度走らせる — 今の回が見ていない変更を落とさないため。
    if (running.pull && pull) return running.run;
    return running.run.then(() => syncGoogleCalendar(account, options));
  }
  const run = runCalendarSync(account, account.id, pull).finally(() => {
    if (inFlight.get(account.id!)?.run === run) inFlight.delete(account.id!);
  });
  inFlight.set(account.id, { run, pull });
  return run;
}

async function runCalendarSync(account: GmailAccount, accountId: string, pull: boolean): Promise<CalendarSyncResult> {
  const result = { ...EMPTY_CALENDAR_SYNC_RESULT };
  try {
    const fresh = await ensureFreshAccessToken(account);

    const rebaseline = async () => {
      const token = await fetchBaselineToken(fresh.accessToken);
      await db.gmailAccounts.update(accountId, {
        calendarSyncToken: token,
        calendarLastSyncedAt: Date.now(),
        calendarSyncError: "",
      });
      return { ...result, baselined: true };
    };

    if (pull) {
      if (!account.calendarSyncToken) return await rebaseline();

      let changes: { items: GoogleCalendarItem[]; nextSyncToken: string };
      try {
        changes = await fetchChanges(fresh.accessToken, account.calendarSyncToken);
      } catch (err) {
        // 起点が古くなった(Google側で失効した)。取り直すしかなく、その間の変更は拾えない。
        if (err instanceof GoogleCalendarError && err.status === 410) return await rebaseline();
        throw err;
      }

      const now = Date.now();
      for (const item of changes.items) {
        if (!item.id) continue;
        const known = await findLink(account.email, item.id);
        // こちらが書き出した版がそのまま返ってきただけなら、取り込み直さない(LIFE HUB の側の中身がもとなので)。
        if (known?.googleUpdated && item.updated && known.googleUpdated === item.updated) continue;
        // 予定のid: 対応表にあればそれ、LIFE HUB が付けた形のidならその予定、それ以外は Google のidから毎回同じ値。
        const eventId = known?.eventId ?? eventIdFromGoogleId(item.id) ?? (await importedEventId(account.email, item.id));
        const linkId = known?.id ?? (await importedLinkId(account.email, item.id));
        const existing = await db.calendarEvents.get(eventId);
        const mapped = fromGoogleEvent(item, existing, now);
        if (mapped.kind === "skip") {
          result.skipped++;
          continue;
        }
        if (mapped.kind === "delete") {
          // 連携を始める前からあった予定は、そもそも取り込んでいないので何も起きない。
          if (existing) {
            await db.calendarEvents.delete(eventId);
            result.deleted++;
          }
          await db.googleCalendarLinks.delete(linkId);
          continue;
        }
        await db.calendarEvents.put({ ...mapped.event, id: eventId });
        await db.googleCalendarLinks.put({
          id: linkId,
          eventId,
          accountEmail: account.email,
          googleEventId: item.id,
          googleUpdated: item.updated,
          createdAt: known?.createdAt ?? now,
          updatedAt: now,
        });
        if (existing) result.updated++;
        else result.added++;
      }

      await db.gmailAccounts.update(accountId, {
        calendarSyncToken: changes.nextSyncToken,
        calendarLastSyncedAt: now,
        calendarSyncError: "",
      });
    }

    await exportToGoogle(fresh, result);
    if (!pull) await db.gmailAccounts.update(accountId, { calendarSyncError: "" });
    return result;
  } catch (err) {
    const { message } = describeCalendarError(err);
    // 失敗しても最後に試した時刻は進める。進めないと、画面を開くたびに同じ失敗を繰り返す。
    await db.gmailAccounts
      .update(accountId, { calendarSyncError: message, calendarLastSyncedAt: Date.now() })
      .catch(() => undefined);
    return { ...result, error: message };
  }
}

/** このアカウントの、Google側のidに対応する対応表の行。 */
async function findLink(accountEmail: string, googleEventId: string): Promise<GoogleCalendarLink | undefined> {
  const rows = await db.googleCalendarLinks.where("[accountEmail+googleEventId]").equals([accountEmail, googleEventId]).toArray();
  return rows[0];
}

/**
 * LIFE HUB → Google の書き出し。planExport で決めた分を順に送る。
 * 1件でも失敗したらそこで止めて例外にする(残りは次の回で送る)。対応表は Google が受け取ってから書くので、
 * 途中で止まっても二度送りにはならない(作る方は Google側のidが毎回同じなので、2回目は 409 で更新の側へ回る)。
 */
async function exportToGoogle(account: GmailAccount, result: CalendarSyncResult): Promise<void> {
  if (!account.calendarSyncEnabledAt) return;
  const [events, links] = await Promise.all([db.calendarEvents.toArray(), db.googleCalendarLinks.toArray()]);
  const plan = planExport(events, links, account.email, account.calendarSyncEnabledAt);
  const timeZone = localTimeZone();
  let ops = 0;

  for (const link of plan.remove) {
    if (ops++ >= MAX_EXPORT_OPS_PER_RUN) return;
    try {
      await calendarWrite(account.accessToken, "DELETE", `/${encodeURIComponent(link.googleEventId)}`);
    } catch (err) {
      // もう Google側に無い(向こうでも消した)なら、それでよい。
      if (!(err instanceof GoogleCalendarError && (err.status === 404 || err.status === 410))) throw err;
    }
    if (link.id) await db.googleCalendarLinks.delete(link.id);
    result.removed++;
  }

  for (const { event, link } of plan.update) {
    if (ops++ >= MAX_EXPORT_OPS_PER_RUN) return;
    let saved: GoogleCalendarItem | null;
    try {
      saved = await calendarWrite(account.accessToken, "PATCH", `/${encodeURIComponent(link.googleEventId)}`, toGoogleEvent(event, timeZone));
    } catch (err) {
      // Google側で消されている。次の取り込みで LIFE HUB の側も消えるので、ここでは触らない。
      if (err instanceof GoogleCalendarError && (err.status === 404 || err.status === 410)) continue;
      throw err;
    }
    await db.googleCalendarLinks.put({
      ...link,
      googleUpdated: saved?.updated ?? link.googleUpdated,
      updatedAt: Math.max(Date.now(), changedAt(event)),
    });
    result.exported++;
  }

  for (const event of plan.create) {
    if (!event.id) continue;
    if (ops++ >= MAX_EXPORT_OPS_PER_RUN) return;
    const googleEventId = googleEventIdFor(event.id);
    let saved: GoogleCalendarItem | null;
    try {
      saved = await calendarWrite(account.accessToken, "POST", "", { ...toGoogleEvent(event, timeZone), id: googleEventId });
    } catch (err) {
      // 同じidがもうある = ほかの端末が先に送った(か、前に消した予定を戻した)。中身を上書きし、消されていれば戻す。
      if (!(err instanceof GoogleCalendarError && err.status === 409)) throw err;
      saved = await calendarWrite(account.accessToken, "PATCH", `/${googleEventId}`, toGoogleEvent(event, timeZone));
    }
    const now = Date.now();
    await db.googleCalendarLinks.put({
      id: await importedLinkId(account.email, googleEventId),
      eventId: event.id,
      accountEmail: account.email,
      googleEventId,
      googleUpdated: saved?.updated,
      createdAt: now,
      updatedAt: Math.max(now, changedAt(event)),
    });
    result.exported++;
  }
}

/** 自動の同期を走らせてよいアカウントか(入にしてある・権限がある・連携が切れていない・間隔が空いた)。 */
export function shouldAutoSyncCalendar(account: GmailAccount, now: number): boolean {
  if (!isCalendarSyncReady(account)) return false;
  return !account.calendarLastSyncedAt || now - account.calendarLastSyncedAt >= CALENDAR_AUTO_SYNC_COOLDOWN_MS;
}

/** つなぎ直しから戻ってきた時に、どのアカウントでカレンダーの同期を入にするかの控え
 * (GmailCallbackPage が読む)。行きと帰りで同じタブなので sessionStorage に置く。 */
export const CALENDAR_ENABLE_AFTER_CONNECT_KEY = "googleCalendarEnableAfterConnect";
