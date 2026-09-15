import { schedule, type Handler } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendNotification, setVapidDetails, WebPushError } from "web-push";

/** push_subscriptions.disabled_categoriesに入り得る値のうち、この関数が担当する種類
 * (src/lib/pushNotifications.tsのNOTIFICATION_CATEGORIESと同じ文字列)。 */
const CATEGORY = "morning_briefing";

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  disabled_categories: string[] | null;
}

/** calendar_events の1行(必要な列だけ)。 */
export interface BriefingEventRow {
  title: string;
  date: string;
  end_date: string | null;
  start_time: string | null;
  all_day: boolean | null;
  repeat: string | null;
  repeat_until: string | null;
}

export interface TodayEvent {
  title: string;
  /** その日に始まる時刻つきの予定だけが持つ(HH:mm)。 */
  time?: string;
}

// このアプリは個人利用の日本語専用アプリという前提(CLAUDE.md)。日付はすべて端末の
// ローカル時刻のままタイムゾーン情報を持たずに保存されているため、
// checkRemindersAndNotify.ts・checkBudgetAndNotify.tsと同じ割り切りでJST固定として扱う。
const JST_OFFSET_MS = 9 * 60 * 60_000;
const ONE_DAY_MS = 24 * 60 * 60_000;
/** 画面側(src/lib/eventSpan.ts)の MAX_REPEAT_DAYS と同じ。 */
const MAX_REPEAT_DAYS = 730;
/** 「重要な未読」に数える範囲。受信トレイに出るのは直近30日(src/lib/gmailSync.ts)なので、
 * それより前に付けた印まで数えると、ホームの件数と食い違ったまま増え続ける。 */
const IMPORTANT_WINDOW_DAYS = 30;
const WEEKDAY_PREFIX = "weekdays:";

/** nowMsをJSTの壁時計として見た日付(YYYY-MM-DD)。 */
export function jstTodayStr(nowMs: number): string {
  return new Date(nowMs + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD を UTC の0時(ms)に。存在しない日付(2026-02-30など)・形の違う文字は null。 */
function parseDay(date: string | null | undefined): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return toDay(parseDay(date)! + days * ONE_DAY_MS);
}

function diffDays(from: string, to: string): number {
  return Math.round((parseDay(to)! - parseDay(from)!) / ONE_DAY_MS);
}

/** date-fns の addMonths と同じく、短い月は月末に寄せる(1/31 の1か月後は 2/28)。 */
function addMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month0 = Number(date.slice(5, 7)) - 1 + months;
  const day = Number(date.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return toDay(Date.UTC(year, month0, Math.min(day, lastDay)));
}

function parseWeekdayRepeat(repeat: string | undefined): number[] | null {
  if (!repeat || !repeat.startsWith(WEEKDAY_PREFIX)) return null;
  const days = repeat
    .slice(WEEKDAY_PREFIX.length)
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const unique = [...new Set(days)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : null;
}

function isRepeating(repeat: string | undefined): boolean {
  if (!repeat || repeat === "none") return false;
  if (repeat === "daily" || repeat === "weekly" || repeat === "monthly") return true;
  return parseWeekdayRepeat(repeat) !== null;
}

export interface EventSpan {
  date: string;
  endDate?: string;
  repeat?: string;
  repeatUntil?: string;
}

function spanEndDate(span: EventSpan): string {
  if (parseDay(span.endDate) == null || parseDay(span.date) == null) return span.date;
  return span.endDate! > span.date ? span.endDate! : span.date;
}

function spanDays(span: EventSpan): number {
  if (parseDay(span.date) == null) return 1;
  return diffDays(span.date, spanEndDate(span)) + 1;
}

function repeatHorizon(span: EventSpan): string {
  if (span.repeatUntil && parseDay(span.repeatUntil) != null && span.repeatUntil > span.date) return span.repeatUntil;
  return addDays(span.date, MAX_REPEAT_DAYS);
}

/**
 * dateがかかっている「回」の開始日。かかっていなければundefined。
 *
 * **画面側 src/lib/eventSpan.ts の occurrenceStartOn の写し。** Netlify の関数からは
 * src/ を import しない(Vercel 版で import 先がバンドルに入らず落ちた経緯があり、この
 * リポジトリの関数はすべて自己完結にしてある)。食い違うと「ホームには出ているのに
 * 朝の通知では予定なし」になるので、netlify/__tests__/sendMorningBriefing.test.ts が
 * 同じ入力で両方を突き合わせている。
 */
export function occurrenceStartOn(span: EventSpan, date: string): string | undefined {
  if (date >= span.date && date <= spanEndDate(span)) return span.date;
  if (!isRepeating(span.repeat) || parseDay(span.date) == null || parseDay(date) == null) return undefined;

  const horizon = repeatHorizon(span);
  if (date > horizon) return undefined;

  const duration = spanDays(span);
  const daysSinceStart = diffDays(span.date, date);
  if (daysSinceStart <= 0) return undefined;

  const weekdays = parseWeekdayRepeat(span.repeat);
  if (weekdays) return weekdays.includes(new Date(parseDay(date)!).getUTCDay()) ? date : undefined;

  if (span.repeat === "daily") return date;

  if (span.repeat === "weekly") {
    const offsetInWeek = daysSinceStart % 7;
    return offsetInWeek < duration ? addDays(span.date, daysSinceStart - offsetInWeek) : undefined;
  }

  const maxMonths = Math.ceil(diffDays(span.date, horizon) / 28) + 2;
  for (let n = 1; n <= maxMonths; n++) {
    const occurrenceStart = addMonths(span.date, n);
    if (occurrenceStart > horizon) break;
    const occurrenceEnd = addDays(occurrenceStart, duration - 1);
    if (date >= occurrenceStart && date <= occurrenceEnd) return occurrenceStart;
  }
  return undefined;
}

/**
 * 今日かかっている予定。何日かにまたがる予定の2日目以降は、開始時刻を持たせない —
 * 泊まっている最中の宿泊が「10:00〜」として毎朝出てこないように(ホームと同じ扱い)。
 * 並びもホームと同じで、時刻の無いものが先、時刻のあるものは早い順。
 */
export function todaysEvents(rows: BriefingEventRow[], today: string): TodayEvent[] {
  const events: TodayEvent[] = [];
  for (const row of rows) {
    const start = occurrenceStartOn(
      {
        date: row.date,
        endDate: row.end_date ?? undefined,
        repeat: row.repeat ?? undefined,
        repeatUntil: row.repeat_until ?? undefined,
      },
      today,
    );
    if (start === undefined) continue;
    const time = !row.all_day && start === today && row.start_time ? row.start_time.slice(0, 5) : undefined;
    events.push({ title: row.title, time });
  }
  return events.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
}

/**
 * 朝の通知の文面(public/push-sw.js の単一の push ハンドラで消費される形)。
 * 例: 「予定3件(最初は10:00 歯医者)・重要な未読メール1件」
 *
 * 返信待ちはここには入れない。判定に使う送信の記録(draftReplies)と受信トレイの中身は
 * 端末の中にしか無く、サーバーからは見えないため。ホームの「今日のまとめ」には出る。
 */
export function buildMorningBriefingPayload(today: string, events: TodayEvent[], importantUnread: number): string {
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const parts: string[] = [];
  if (events.length === 0) {
    parts.push("今日の予定はありません");
  } else {
    const firstTimed = events.find((event) => event.time);
    parts.push(
      firstTimed
        ? `予定${events.length}件（最初は${firstTimed.time} ${firstTimed.title}）`
        : `予定${events.length}件（${events[0].title}）`,
    );
  }
  if (importantUnread > 0) parts.push(`重要な未読メール${importantUnread}件`);
  return JSON.stringify({ title: `今日のまとめ（${month}/${day}）`, body: parts.join("・"), url: "/" });
}

async function sendToUser(supabase: SupabaseClient, subs: PushSubscriptionRow[], payload: string): Promise<void> {
  for (const sub of subs) {
    try {
      await sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload);
    } catch (err) {
      if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        console.error("[sendMorningBriefing] push send failed:", err);
      }
    }
  }
}

async function processUser(
  supabase: SupabaseClient,
  userId: string,
  subs: PushSubscriptionRow[],
  today: string,
  nowMs: number,
): Promise<void> {
  // 開始日が今日より後の予定は、繰り返しでも今日にはかからないので最初から引かない。
  const { data: eventRows, error: eventsError } = await supabase
    .from("calendar_events")
    .select("title, date, end_date, start_time, all_day, repeat, repeat_until")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .lte("date", today);
  if (eventsError) {
    console.error(`[sendMorningBriefing] failed to load calendar_events for ${userId}:`, eventsError.message);
    return;
  }

  // 重要な未読は、端末間で既読・重要を揃えている gmail_message_state から数える
  // (ホームの数え方と同じ: 重要を付けた・読んでいない・返信していない)。
  // 引けなくても予定のまとめは送る。
  const { count, error: mailError } = await supabase
    .from("gmail_message_state")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("important_at", "is", null)
    .is("read_at", null)
    .eq("sent", false)
    .gte("important_at", new Date(nowMs - IMPORTANT_WINDOW_DAYS * ONE_DAY_MS).toISOString());
  if (mailError) console.warn(`[sendMorningBriefing] gmail_message_state unavailable for ${userId}:`, mailError.message);

  const events = todaysEvents((eventRows ?? []) as BriefingEventRow[], today);
  await sendToUser(supabase, subs, buildMorningBriefingPayload(today, events, mailError ? 0 : (count ?? 0)));
}

const handlerImpl: Handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error("[sendMorningBriefing] missing required environment variables, skipping run");
    return { statusCode: 500, body: "not configured" };
  }

  setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const nowMs = Date.now();
  const today = jstTodayStr(nowMs);

  const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
  if (error) {
    console.error("[sendMorningBriefing] failed to load push_subscriptions:", error.message);
    return { statusCode: 500, body: error.message };
  }

  const byUser = new Map<string, PushSubscriptionRow[]>();
  for (const sub of (subs ?? []) as PushSubscriptionRow[]) {
    // この種類を止めている端末には送らない。全部の端末で止めていれば集計そのものを省く。
    if ((sub.disabled_categories ?? []).includes(CATEGORY)) continue;
    const list = byUser.get(sub.user_id) ?? [];
    list.push(sub);
    byUser.set(sub.user_id, list);
  }

  for (const [userId, userSubs] of byUser) {
    try {
      await processUser(supabase, userId, userSubs, today, nowMs);
    } catch (err) {
      console.error(`[sendMorningBriefing] failed for ${userId}:`, err);
    }
  }

  return { statusCode: 200, body: "ok" };
};

/**
 * 毎朝7時(JST)に「今日のまとめ」を1通送る(依頼「朝の一括ブリーフィングが欲しい」)。
 * 予定が無い日も「今日の予定はありません」として送る — 届いたり届かなかったりすると、
 * 止まったのか予定が無いのかを見分けられないため。要らなければ設定の「朝のまとめ」で止められる。
 * cron は UTC なので 22:00 = JST 7:00。
 */
export const handler = schedule("0 22 * * *", handlerImpl);
