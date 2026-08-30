import { addHours, format, parseISO } from "date-fns";
import type { CalendarEvent, RepeatRule } from "../types";
import { spanEndDate } from "./eventSpan";
import { todayStr } from "./date";

/**
 * 予定(CalendarEvent)を iCalendar(.ics、RFC 5545)にする。iPhoneの標準カレンダーや
 * Googleカレンダーが読める形式で、取り込む側は書き出した時点の写しを持つだけ
 * (このアプリと繋がり続けるわけではない)。
 *
 * 時刻の扱いは「浮動時間」— TZID もUTCの Z も付けない。このアプリは日付も時刻も
 * タイムゾーンを持たない文字列(YYYY-MM-DD / HH:mm)のまま保存していて、書いた本人の
 * 手元の時計がそのまま正しい(netlify/functions/checkBudgetAndNotify.ts と同じ割り切り)。
 * 浮動時間は取り込んだ端末のローカル時刻として読まれるので、この持ち方と食い違わない。
 */

const PRODID = "-//LIFE HUB//JP";

/** 1行の上限(オクテット)。RFC 5545 は75オクテットで折り返すよう決めている。 */
const MAX_LINE_OCTETS = 75;

const encoder = new TextEncoder();

/** 値の中の特殊文字を逃がす。バックスラッシュを最初に置き換えないと、後から足した
 * 逃がし記号までもう一度逃がしてしまう。 */
export function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** 長い行を75オクテットで折り返す(続きの行は空白1つで始める)。日本語は1文字3
 * オクテットなので、文字数ではなくバイト数で数える — 文字の途中で切ると化ける。 */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;
  const parts: string[] = [];
  let current = "";
  let currentOctets = 0;
  // 続きの行は先頭の空白1つぶんを使うので、2行目以降の中身は74オクテットまで。
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const octets = encoder.encode(char).length;
    if (currentOctets + octets > limit) {
      parts.push(current);
      current = "";
      currentOctets = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    current += char;
    currentOctets += octets;
  }
  if (current) parts.push(current);
  return parts.join("\r\n ");
}

/** YYYY-MM-DD → YYYYMMDD。 */
export function icsDate(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

/** YYYY-MM-DD と HH:mm → YYYYMMDDTHHMMSS(浮動時間)。 */
export function icsDateTime(dateStr: string, time: string): string {
  return `${icsDate(dateStr)}T${time.replace(":", "")}00`;
}

/** DTSTAMP 用のUTC時刻。ここだけは「このファイルを作った瞬間」なので Z を付ける。 */
export function icsStamp(epochMs: number): string {
  return `${new Date(epochMs).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/** 終日予定の DTEND は「その日を含まない」翌日を指す(RFC 5545)。 */
function nextDay(dateStr: string): string {
  const d = parseISO(dateStr);
  d.setDate(d.getDate() + 1);
  return format(d, "yyyyMMdd");
}

const FREQ: Record<Exclude<RepeatRule, "none">, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
};

/** 繰り返しの行。UNTIL は DTSTART と同じ形(終日なら日付、時刻付きなら浮動時間)で
 * 書かないと、取り込む側が弾く。 */
function repeatRule(event: CalendarEvent, allDay: boolean): string | null {
  const repeat = event.repeat;
  if (!repeat || repeat === "none") return null;
  const parts = [`FREQ=${FREQ[repeat]}`];
  if (event.repeatUntil) {
    parts.push(`UNTIL=${allDay ? icsDate(event.repeatUntil) : `${icsDate(event.repeatUntil)}T235959`}`);
  }
  return `RRULE:${parts.join(";")}`;
}

/** 時刻付きの予定の終わり。終了時刻が無い(または開始より前)ときは1時間後にする —
 * 長さ0の予定は、取り込んだ先のカレンダーで線1本になって読めない。 */
function timedEnd(event: CalendarEvent): string {
  const start = `${event.date}T${event.startTime}`;
  const endDate = event.endDate && event.endDate > event.date ? event.endDate : event.date;
  if (event.endTime) {
    const end = `${endDate}T${event.endTime}`;
    if (end > start) return icsDateTime(endDate, event.endTime);
  } else if (endDate > event.date) {
    return icsDateTime(endDate, event.startTime!);
  }
  const oneHourLater = addHours(parseISO(start), 1);
  return format(oneHourLater, "yyyyMMdd'T'HHmmss");
}

/** 予定1件ぶんの VEVENT。 */
export function buildVevent(event: CalendarEvent, stamp: string, fallbackUid: string): string[] {
  // 開始時刻が無い予定は終日として書き出す。allDay の印が付いていなくても、
  // 時刻の分からない予定に 00:00 を付けると「深夜0時の予定」に化ける。
  const allDay = Boolean(event.allDay) || !event.startTime;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id ?? fallbackUid}@life-hub`,
    `DTSTAMP:${stamp}`,
  ];

  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(event.date)}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay(spanEndDate(event))}`);
  } else {
    lines.push(`DTSTART:${icsDateTime(event.date, event.startTime!)}`);
    lines.push(`DTEND:${timedEnd(event)}`);
  }

  lines.push(`SUMMARY:${icsEscape(event.title)}`);
  if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
  if (event.memo) lines.push(`DESCRIPTION:${icsEscape(event.memo)}`);
  const rule = repeatRule(event, allDay);
  if (rule) lines.push(rule);
  lines.push("END:VEVENT");
  return lines;
}

/** 予定をまとめて1つのカレンダーにする。日付の古い順に並べる。 */
export function buildCalendarIcs(events: CalendarEvent[], now: number = Date.now()): string {
  const stamp = icsStamp(now);
  const sorted = [...events].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""),
  );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:LIFE HUB",
    ...sorted.flatMap((event, index) => buildVevent(event, stamp, `life-hub-${index}`)),
    "END:VCALENDAR",
  ];
  // 改行はCRLF(RFC 5545)。折り返しも同じ改行を使う。
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export function calendarIcsFilename(today: string = todayStr()): string {
  return `life-hub-events-${today}.ics`;
}

/** ファイルとして落とす(CSV書き出し・バックアップと同じやり方)。 */
export function downloadIcs(ics: string, filename: string): void {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
