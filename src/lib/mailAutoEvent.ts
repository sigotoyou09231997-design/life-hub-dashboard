import { db } from "../db/schema";
import type { CalendarEvent, GmailAccount, SyncedEmail } from "../types";
import { todayStr } from "./date";
import { toEventMailLinkRecord } from "./eventMailLink";
import { stableUuid } from "./googleCalendar";
import { detectPlanSignals, isPromoText, normalizeText } from "./mailPlanSuggestion";

/**
 * 「日時が確定した」と書いてあるメールを、確認なしでカレンダーの予定に入れる(2026-11-21、本人「確定した予定を
 * todoアプリのカレンダーに自動で入るようにしたい」)。
 *
 * 予定候補(src/lib/mailPlanSuggestion.ts)は、見つけても本人が「予定を追加」を押すまで何も入れない。
 * こちらは押さずに入れるので、**間違って入れない**ことを優先して、次の全部が揃った時だけ入れる:
 *  - 「確定」「予約完了」のような、決まったことを言う言葉がある
 *  - 候補を並べて選ばせるメール(「いかがでしょうか」「ご都合」「候補」)ではない
 *  - 読み取れる日付がちょうど1日で、時刻もあり、まだ過ぎていない
 *  - 面接・面談・予約・打ち合わせのような、予定の種類を言う言葉がある
 *  - 3日以内に届いたメール(古いメールを後から掘り起こして入れない)
 * AI は使わない。本人の端末の中の文字合わせだけ。入れた予定には元のメールへのリンクが付く
 * (予定の編集画面の「元のメールを開く」)ので、読み違いは辿って直せる。
 *
 * 「日程が確定しましたら、URLをお送りします」のように、これから決まるという意味の「確定」は数えない。
 * 実際のトップクラウドの面接案内(2026-11-20)がこの形だった。
 */

/** 決まったことを言う言葉。 */
const CONFIRM_WORDS = [
  "確定",
  "決定いたしました",
  "決定しました",
  "決定となりました",
  "承りました",
  "予約完了",
  "予約が完了",
  "予約を受け付け",
  "予約を受付",
  "お申込み完了",
  "お申し込み完了",
  "申込みが完了",
  "申し込みが完了",
];

/** 「確定しましたら」のように、まだ決まっていない言い方。これを消してから確定の言葉を探す。 */
const NOT_YET_CONFIRMED = /確定(?:しましたら|いたしましたら|でき次第|し次第|次第|後に?|したら|になりましたら|となりましたら)/g;

/** 候補を挙げて相手に選ばせる・都合を聞く言葉。これがあれば確定ではない。 */
const PROPOSAL_WORDS = [
  "候補",
  "いかがでしょう",
  "いかがですか",
  "ご都合",
  "ご希望",
  "再調整",
  "お選び",
  "第1希望",
  "第一希望",
  "いずれか",
  "可能でしょうか",
  "ご検討",
  "ご調整いただ",
  "調整をお願い",
];

/** 予定の種類を言う言葉。「日程」「予定」のような一般的な言葉は、請求書や広告にも出るので入れない。 */
const EVENT_WORDS = [
  "面接",
  "面談",
  "説明会",
  "選考",
  "適性検査",
  "筆記試験",
  "インターン",
  "顔合わせ",
  "打ち合わせ",
  "打合せ",
  "ミーティング",
  "会議",
  "商談",
  "予約",
  "見学",
  "来社",
  "来訪",
  "訪問",
  "ご来院",
  "診察",
  "健診",
  "検診",
];

/** メールが届いてから、これより古いものは入れない。 */
export const AUTO_EVENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export interface ConfirmedSchedule {
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  /** 見つけた言葉(「確定・面接」)。予定のメモに残す。 */
  reason: string;
}

type AutoEventEmail = Pick<SyncedEmail, "subject" | "snippet" | "status"> & {
  receivedAt?: number;
  planSuggestionDismissedAt?: number;
  planText?: string;
  autoEventAt?: number;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** 「午後2時」「14:30」「10時半」を HH:mm にする。時間として読めなければ undefined。 */
function readClock(prefix: string | undefined, hour: number, minute: number): string | undefined {
  let h = hour;
  if (prefix === "午後" && h < 12) h += 12;
  if (prefix === "午前" && h === 12) h = 0;
  if (h > 23 || minute > 59) return undefined;
  return `${pad(h)}:${pad(minute)}`;
}

const CLOCK = /(午前|午後)?\s*(\d{1,2})\s*(?::\s*(\d{2})|時\s*(?:(半)|(\d{1,2})\s*分)?)(?!間)/;
const RANGE_END = /^\s*[〜~～\-－ー–—]\s*(午前|午後)?\s*(\d{1,2})\s*(?::\s*(\d{2})|時\s*(?:(半)|(\d{1,2})\s*分)?)/;

function clockFrom(match: RegExpMatchArray): string | undefined {
  const minute = match[3] ? Number(match[3]) : match[4] ? 30 : match[5] ? Number(match[5]) : 0;
  return readClock(match[1], Number(match[2]), minute);
}

/** 本文の中の最初の時刻(と、「19:30〜20:30」のように書かれていれば終わりの時刻)。 */
export function readTimeRange(text: string): { start: string; end?: string } | undefined {
  const match = text.match(CLOCK);
  if (!match || match.index === undefined) return undefined;
  const start = clockFrom(match);
  if (!start) return undefined;
  const after = text.slice(match.index + match[0].length);
  const endMatch = after.match(RANGE_END);
  const end = endMatch ? clockFrom(endMatch) : undefined;
  return { start, end: end && end > start ? end : undefined };
}

function addOneHour(start: string): string {
  const [h, m] = start.split(":").map(Number);
  // 23時台に始まる予定は日をまたがないよう、23:59 で止める。
  if (h >= 23) return "23:59";
  return `${pad(h + 1)}:${pad(m)}`;
}

function cleanTitle(subject: string, eventWord: string): string {
  const base = normalizeText(subject)
    .replace(/^(?:\s*(?:re|fwd?|fw)\s*:\s*)+/i, "")
    .replace(/[【】[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // 件名に予定の種類が無い(「メッセージが届きました」のような通知)時は、何の予定か分かるよう頭に添える。
  const titled = !base ? eventWord : base.includes(eventWord) ? base : `${eventWord}: ${base}`;
  return titled.length > 40 ? `${titled.slice(0, 40)}…` : titled;
}

/**
 * このメールが「確定した予定」を知らせているか。そうなら入れる中身を、そうでなければ null を返す。
 * 入れる前の判定だけで、何も書き込まない。
 */
export function detectConfirmedSchedule(email: AutoEventEmail, now: number = Date.now()): ConfirmedSchedule | null {
  if (email.autoEventAt || email.planSuggestionDismissedAt) return null;
  if (email.status === "skipped") return null;
  if (email.receivedAt === undefined || email.receivedAt < now - AUTO_EVENT_WINDOW_MS) return null;

  const raw = [email.subject, email.snippet, email.planText ?? ""].join(" ");
  if (isPromoText(raw)) return null;
  const text = normalizeText(raw);

  if (PROPOSAL_WORDS.some((word) => text.includes(word))) return null;
  const decided = text.replace(NOT_YET_CONFIRMED, " ");
  const confirmWord = CONFIRM_WORDS.find((word) => decided.includes(word));
  if (!confirmWord) return null;
  const eventWord = EVENT_WORDS.find((word) => text.includes(word));
  if (!eventWord) return null;

  const signals = detectPlanSignals(raw, email.receivedAt);
  if (signals.dates.length !== 1) return null;
  const date = signals.dates[0];
  if (date < todayStr()) return null;

  const range = readTimeRange(text);
  if (!range) return null;

  return {
    date,
    startTime: range.start,
    endTime: range.end ?? addOneHour(range.start),
    title: cleanTitle(email.subject, eventWord),
    reason: `${confirmWord}・${eventWord}`,
  };
}

/** 同じ日の同じ時刻に、もう予定が入っているか(本人が先に手で入れた時に、二重にしないため)。 */
async function alreadyOnCalendar(found: ConfirmedSchedule): Promise<boolean> {
  const sameDay = await db.calendarEvents.where("date").equals(found.date).toArray();
  return sameDay.some((event) => event.startTime === found.startTime && !event.allDay);
}

/**
 * このアカウントの最近のメールから、確定した予定を探してカレンダーに入れる。入れた予定のタイトルを返す。
 *
 * - 予定のidはメールから毎回同じ値を作る。複数の端末で同じメールを見ても1件にしかならない。
 * - 入れた(または、すでに入っていた)メールには autoEventAt を付けて、二度は見ない。
 *   本人が予定を消しても、同じメールから入れ直さない。
 * - 入れたメールは「予定を追加しますか?」の候補からも外す(同じ話が二重に出ないため)。
 * - 設定の「確定した予定を自動で入れる」が切ってあれば何もしない(未設定はON)。
 */
export async function autoAddConfirmedEvents(
  account: Pick<GmailAccount, "email">,
  accountId: string,
  now: number = Date.now(),
): Promise<string[]> {
  const settings = await db.settings.toCollection().first();
  if (settings?.autoEventEnabled === false) return [];

  const recent = (await db.syncedEmails.where("accountId").equals(accountId).toArray()).filter(
    (email) => email.id && !email.autoEventAt && email.receivedAt >= now - AUTO_EVENT_WINDOW_MS,
  );
  const titles: string[] = [];
  for (const email of recent) {
    const found = detectConfirmedSchedule(email, now);
    if (!found) continue;
    try {
      const eventId = await stableUuid(`mail-auto-event:${account.email.toLowerCase()}:${email.gmailMessageId}`);
      const exists = Boolean(await db.calendarEvents.get(eventId)) || (await alreadyOnCalendar(found));
      if (exists) {
        // 先に入っていたものには手を付けない。見たことだけ覚える。
        await db.syncedEmails.update(email.id!, { autoEventAt: now });
        continue;
      }
      const record: CalendarEvent = {
        id: eventId,
        title: found.title,
        date: found.date,
        allDay: false,
        startTime: found.startTime,
        endTime: found.endTime,
        memo: `メールから自動で入れました(${found.reason})。日時が違う時は元のメールを見て直してください。`,
        category: "other",
        createdAt: now,
      };
      await db.calendarEvents.put(record);
      try {
        const link = toEventMailLinkRecord(eventId, account, email, now);
        await db.eventMailLinks.put({ ...link, id: await stableUuid(`mail-auto-event-link:${account.email.toLowerCase()}:${email.gmailMessageId}`) });
      } catch (error) {
        // 元メールへのリンクを残せなくても、予定そのものは入れたままにする。
        console.error("[mailAutoEvent] failed to remember the source mail:", error);
      }
      await db.syncedEmails.update(email.id!, { autoEventAt: now, planSuggestionDismissedAt: now });
      titles.push(found.title);
    } catch (error) {
      // 1通の失敗で同期全体を止めない。印を付けないので、次の同期でやり直す。
      console.error("[mailAutoEvent] failed to add an event:", error);
    }
  }
  return titles;
}
