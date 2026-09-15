import { addDays, parseISO } from "date-fns";
import { db } from "../db/schema";
import type { CalendarEvent, GmailAccount, RepeatRule } from "../types";
import { toDateStr } from "./date";
import { normalizeEndDate } from "./eventSpan";
import { ensureFreshAccessToken, GOOGLE_CALENDAR_SCOPE, htmlToText } from "./gmail";
import { makeWeekdayRepeat } from "./repeatRule";

/**
 * Googleカレンダーとの連携(依頼「Googleカレンダーと双方向で同期したい」)。
 *
 * **第1段 = Google → LIFE HUB の取り込みだけ。** 依頼本文の「区切って進めてもらって構わない」
 * に沿って、書き出し(LIFE HUB → Google)は第2段に回している(supabase/sql/026 が要る)。
 *
 * - 対象はメインのカレンダー(primary)1つ
 * - 連携を始めた時点で Google の syncToken(起点)だけ取り、その後に足した・変えた・消した
 *   予定だけを取り込む。すでにある予定はどちらの側も触らない、という依頼のとおり
 * - 取り込んだ予定のidは、アドレスとGoogle側のidから毎回同じ値を作る(stableUuid)。
 *   PCとスマホの両方で取り込んでも、calendar_events の同期で同じ行に重なり、2件にならない
 * - 取り込みは端末で行う(Gmailの同期と同じく、その端末で連携したトークンを使う)
 */

export { GOOGLE_CALENDAR_SCOPE };

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary";
/** 画面を開いた時の自動の取り込みを見送る間隔。予定はメールほど頻繁には変わらない。 */
export const CALENDAR_AUTO_SYNC_COOLDOWN_MS = 10 * 60 * 1000;
/** 起点・変更分の取得でたどるページの上限(1ページ2500件)。 */
const MAX_PAGES = 40;

/** 表せない繰り返しを初回だけ入れた時に、メモの末尾へ添える一文。 */
export const UNSUPPORTED_REPEAT_NOTE =
  "(Googleカレンダーでは繰り返しの予定ですが、LIFE HUBでは表せない繰り返し方のため、初回だけ入れています)";

export function hasCalendarScope(account: Pick<GmailAccount, "grantedScopes">): boolean {
  return (account.grantedScopes ?? "").split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE);
}

export function isCalendarSyncEnabled(account: Pick<GmailAccount, "calendarSyncEnabledAt">): boolean {
  return Boolean(account.calendarSyncEnabledAt);
}

/** Google Calendar API の予定1件(使う項目だけ)。 */
export interface GoogleCalendarItem {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
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

/** 取り込みの失敗を、次にやることまで含めた日本語にする。 */
export function describeCalendarError(err: unknown): { message: string; needsReconnect: boolean } {
  const raw = err instanceof Error ? err.message : String(err);
  if (/rateLimitExceeded|userRateLimitExceeded|quotaExceeded|\b429\b/i.test(raw)) {
    return { message: "Googleカレンダーの利用制限に達しました。しばらく待つと、次に開いた時にまた取り込みます", needsReconnect: false };
  }
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(raw)) {
    return {
      message:
        "Google Cloud で Google Calendar API が有効になっていません。Google Cloud Console の「APIとサービス」→「ライブラリ」で Google Calendar API を有効にしてください",
      needsReconnect: false,
    };
  }
  if (/insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT|\(403\)/i.test(raw)) {
    return { message: "カレンダーを読む権限がありません。「つなぎ直してカレンダーも許可する」からやり直してください", needsReconnect: true };
  }
  if (/invalid_grant|revoked|\(401\)/i.test(raw)) {
    return { message: "Googleとの連携が切れています。つなぎ直してください", needsReconnect: true };
  }
  return { message: `Googleカレンダーの取り込みに失敗しました: ${raw}`, needsReconnect: false };
}

export interface CalendarSyncResult {
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
  /** 起点を取り直しただけで、予定は取り込んでいない(連携を始めた直後・起点が古くなった時)。 */
  baselined: boolean;
  error: string | null;
}

/** 取り込み結果をトースト1行に。 */
export function summarizeCalendarSync(result: CalendarSyncResult): string {
  if (result.error) return result.error;
  if (result.baselined) return "Googleカレンダーとつなぎました。これから足した・変えた予定を取り込みます";
  const parts = [
    result.added ? `${result.added}件追加` : "",
    result.updated ? `${result.updated}件更新` : "",
    result.deleted ? `${result.deleted}件削除` : "",
  ].filter(Boolean);
  return parts.length > 0 ? `Googleカレンダーから${parts.join("・")}しました` : "Googleカレンダーに新しい変更はありませんでした";
}

/** 同じアカウントの取り込みを二重に走らせない(ホームと予定の画面が同時に呼ぶことがある)。 */
const inFlight = new Map<string, Promise<CalendarSyncResult>>();

export function syncGoogleCalendar(account: GmailAccount): Promise<CalendarSyncResult> {
  const empty: CalendarSyncResult = { added: 0, updated: 0, deleted: 0, skipped: 0, baselined: false, error: null };
  if (!account.id) return Promise.resolve(empty);
  const running = inFlight.get(account.id);
  if (running) return running;
  const run = runCalendarSync(account, account.id, empty).finally(() => inFlight.delete(account.id!));
  inFlight.set(account.id, run);
  return run;
}

async function runCalendarSync(account: GmailAccount, accountId: string, empty: CalendarSyncResult): Promise<CalendarSyncResult> {
  const result = { ...empty };
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
      const eventId = await importedEventId(account.email, item.id);
      const linkId = await importedLinkId(account.email, item.id);
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
      const link = await db.googleCalendarLinks.get(linkId);
      await db.googleCalendarLinks.put({
        id: linkId,
        eventId,
        accountEmail: account.email,
        googleEventId: item.id,
        googleUpdated: item.updated,
        createdAt: link?.createdAt ?? now,
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

/** 自動の取り込みを走らせてよいアカウントか(入にしてある・権限がある・連携が切れていない・間隔が空いた)。 */
export function shouldAutoSyncCalendar(account: GmailAccount, now: number): boolean {
  if (!isCalendarSyncEnabled(account) || !hasCalendarScope(account) || account.reauthRequiredAt) return false;
  return !account.calendarLastSyncedAt || now - account.calendarLastSyncedAt >= CALENDAR_AUTO_SYNC_COOLDOWN_MS;
}

/** つなぎ直しから戻ってきた時に、どのアカウントでカレンダーの取り込みを入にするかの控え
 * (GmailCallbackPage が読む)。行きと帰りで同じタブなので sessionStorage に置く。 */
export const CALENDAR_ENABLE_AFTER_CONNECT_KEY = "googleCalendarEnableAfterConnect";
