import { addDays, format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { toDateStr, todayStr } from "./date";
import { formatClock, minutesToClock } from "./eventTime";
import { normalizeText, withNearestYear, withWeekday } from "./mailPlanSuggestion";

/**
 * 予定のタイトルに書いた日時を読み取る(「明日19時 歯医者」→ 明日・19:00・「歯医者」)。
 *
 * 予定を足す画面(src/components/calendar/EventForm.tsx)で、タイトルに日時が書いてあれば
 * 「10/13(火) 19:00 で入れる」と提案するための材料。読んだ結果を勝手に入れることはしない —
 * 「3時のおやつ」のような予定名まで時刻に化けるので、入れるかどうかは本人が押して決める。
 *
 * 日付の読み方は、メールから予定を拾う側(src/lib/mailPlanSuggestion.ts)の部品を使い回す。
 * 「来週の火曜」がメールとタイトルで別の日になると、同じアプリの中で言葉の意味が揺れるため。
 * 違うのは2点:
 * - 基準は「今日」(メールは届いた日)。
 * - 「火曜」だけ・「次の火曜」は、今日より後で最初に来るその曜日(今日が火曜なら来週)。
 *   いま書いている予定に「火曜」と書く時、今日のことなら「今日」と書くため。
 *   メールの方は書かれた日と読む日がずれるので今日も含めている。
 */

export interface TitleDateTime {
  /** YYYY-MM-DD。書かれていなければ無し。 */
  date?: string;
  /** "HH:mm"。 */
  startTime?: string;
  /** "HH:mm"。「19時〜21時」のように終わりまで書いてある時だけ。 */
  endTime?: string;
  /** 日時の言葉を取り除いた残り(「歯医者」)。全部が日時だった時は空文字。 */
  title: string;
}

interface Span {
  start: number;
  end: number;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 午前・午後のような、時刻の前に付く言葉。「今夜7時」の「今夜」もここで読む —
 * 「夜」だけ読むと、タイトルに「今」が1文字残ってしまう。 */
const HINT = "(午前|午後|夕方|深夜|今夜|今晩|朝|昼|夜|晩)";

/** 時刻と時刻のあいだの「〜」。「ー」は長音の記号だが、スマホで「19ー21時」と打つ人がいるので入れる。 */
const RANGE_SEPARATOR = "(?:〜|~|～|-|－|ー|から)";

function shiftDays(base: Date, days: number): string {
  return toDateStr(addDays(base, days));
}

/** 今日より後で最初に来るその曜日。今日がその曜日なら1週間後。 */
function nextWeekday(base: Date, weekday: number): string {
  const diff = (weekday - base.getDay() + 7) % 7;
  return shiftDays(base, diff === 0 ? 7 : diff);
}

/** 今週(月曜はじまり。カレンダーの週と同じ)のその曜日。過ぎていてもその日。 */
function thisWeekWeekday(base: Date, weekday: number): string {
  const fromMonday = (base.getDay() + 6) % 7;
  return shiftDays(base, -fromMonday + ((weekday + 6) % 7));
}

/** 「13日」だけの時。今月のその日、過ぎていれば来月のその日(31日が無い月は飛ばす)。 */
function comingDayOfMonth(base: Date, day: number): string | undefined {
  if (day < 1 || day > 31) return undefined;
  for (const monthOffset of [0, 1, 2]) {
    const candidate = new Date(base.getFullYear(), base.getMonth() + monthOffset, day);
    if (candidate.getDate() !== day) continue;
    if (candidate >= base) return toDateStr(candidate);
  }
  return undefined;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

interface DateRule {
  pattern: RegExp;
  read: (match: RegExpMatchArray, base: Date) => string | undefined;
  /** 当たった場所の手前を見て、読まない時は false。 */
  accept?: (text: string, index: number) => boolean;
}

/** 数字の途中から読み始めない(「110/13」の「10/13」を日付にしない)。 */
const notInsideNumber = (text: string, index: number) => !isDigit(text[index - 1]) && text[index - 1] !== "/";

/** 日付の見つけ方。上から順に当て、当たった所は伏せてから次を当てる —
 * 「10月13日」の「13日」を別の日付として読み直さないため(メール側と同じ考え方)。 */
const DATE_RULES: DateRule[] = [
  {
    // 「2026/10/13」「2026年10月13日」「2026-10-13」
    pattern: /(\d{4})\s*[/年.-]\s*(\d{1,2})\s*[/月.-]\s*(\d{1,2})\s*日?/g,
    read: (m) => {
      const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const candidate = new Date(year, month - 1, day);
      return candidate.getMonth() === month - 1 ? toDateStr(candidate) : undefined;
    },
    accept: notInsideNumber,
  },
  {
    // 「10月13日」。「3月3日間」のような長さは日付にしない。
    pattern: /(\d{1,2})\s*月\s*(\d{1,2})\s*日(?!間|目)/g,
    read: (m, base) => withNearestYear(base, Number(m[1]), Number(m[2])),
    accept: notInsideNumber,
  },
  {
    // 「10/13」
    pattern: /(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/g,
    read: (m, base) => withNearestYear(base, Number(m[1]), Number(m[2])),
    accept: notInsideNumber,
  },
  // 「しあさって」は「あさって」を含むので先に読む。
  { pattern: /しあさって|明々後日/g, read: (_m, base) => shiftDays(base, 3) },
  { pattern: /明後日|あさって/g, read: (_m, base) => shiftDays(base, 2) },
  // 「あす」「きょう」は読まない。「あすなろ」「きょうだい」のように言葉の一部になりやすいため。
  { pattern: /明日|あした/g, read: (_m, base) => shiftDays(base, 1) },
  { pattern: /今日|本日/g, read: (_m, base) => shiftDays(base, 0) },
  {
    // 「来週の火曜」「次の金曜日」「今週土曜」「水曜」
    pattern: /(再来週|来週|今週|次|今度)?\s*の?\s*([月火水木金土日])\s*曜日?/g,
    read: (m, base) => {
      const weekday = WEEKDAYS.indexOf(m[2]);
      if (m[1] === "来週") return withWeekday(base, weekday, 1);
      if (m[1] === "再来週") return withWeekday(base, weekday, 2);
      if (m[1] === "今週") return thisWeekWeekday(base, weekday);
      return nextWeekday(base, weekday);
    },
    // 「毎週月曜 ゴミ出し」は繰り返しの話で、次の月曜1回きりの予定ではない。
    accept: (text, index) => !/(毎週?|隔週)\s*$/.test(text.slice(0, index)),
  },
  {
    // 「13日」だけ。「3日間」「2日目」「3日後」「1日1回」のような長さ・回数は日付にしない
    // (「13日 19時」の後ろの数字は時刻なので、数字の後ろが回数の言葉の時だけ外す)。
    pattern: /(\d{1,2})\s*日(?![間目後前分]|ぶり|以内|中|おき|\s*\d+\s*(?:回|錠|本|個|杯|粒|食|度|件|人|時間))/g,
    read: (m, base) => comingDayOfMonth(base, Number(m[1])),
    // 「毎月13日」は繰り返しの話。
    accept: (text, index) => notInsideNumber(text, index) && !/毎月\s*$/.test(text.slice(0, index)),
  },
];

/** 日付のすぐ後ろの「(火)」。日付と一緒に取り除く。 */
const WEEKDAY_IN_PARENS = /^\s*\(\s*[月火水木金土日](?:曜日?)?\s*\)/;

/** 「19時」「19時半」「19時15分」「19:15」「夜7時」。「1時間」は長さなので時刻にしない。 */
const TIME_PATTERN = new RegExp(
  `${HINT}?\\s*(\\d{1,2})\\s*(?::\\s*(\\d{2})(?!\\d)|時(?!間)(?:\\s*(半)|\\s*(\\d{1,2})\\s*分)?)`,
  "g",
);

/** 「19〜21時」の「19〜」。終わりの時刻の手前にだけ現れる、「時」の付かない開始。 */
const BARE_START_BEFORE = new RegExp(`${HINT}?\\s*(\\d{1,2})\\s*${RANGE_SEPARATOR}\\s*$`);

const ONLY_RANGE_SEPARATOR = new RegExp(`^\\s*${RANGE_SEPARATOR}\\s*$`);

interface TimeToken extends Span {
  hint?: string;
  hour: number;
  minute: number;
}

/** 午後・夜などを24時間の「時」に直す。読めない組み合わせは undefined。 */
function resolveHour(hint: string | undefined, hour: number): number | undefined {
  let resolved = hour;
  switch (hint) {
    case "午後":
    case "夕方":
      // 「午後12時」は昼の12時として使われることが多いので、12はそのまま。
      if (hour >= 1 && hour <= 11) resolved = hour + 12;
      break;
    case "夜":
    case "今夜":
    case "今晩":
    case "晩":
      // 「夜1時」「夜12時」は日付をまたいだ真夜中で、どの日の予定かが変わってしまう。
      // 日付まで推し量ると間違えやすいので、時刻としては読まない。
      if (hour === 0 || hour === 12 || (hour >= 1 && hour <= 4)) return undefined;
      if (hour <= 11) resolved = hour + 12;
      break;
    case "昼":
      // 「昼1時」は13時。「昼12時」「昼11時」はそのまま。
      if (hour >= 1 && hour <= 5) resolved = hour + 12;
      break;
    case "午前":
      if (hour === 12) resolved = 0;
      break;
    default:
      // 「朝」「深夜」と、何も付かない時は書かれた数字のまま。「3時」を15時と決めつけない —
      // 提案の文に「3:00」と出るので、違えば押す前に気付ける。
      break;
  }
  return resolved >= 0 && resolved <= 23 ? resolved : undefined;
}

const PM_HINTS = new Set(["午後", "夕方", "夜", "今夜", "今晩", "晩", "昼"]);

function toClock(hour: number, minute: number): string | undefined {
  if (minute < 0 || minute > 59) return undefined;
  return minutesToClock(hour * 60 + minute);
}

function readTimeTokens(text: string): TimeToken[] {
  const tokens: TimeToken[] = [];
  for (const match of text.matchAll(TIME_PATTERN)) {
    const index = match.index ?? 0;
    if (isDigit(text[index - 1])) continue;
    const minute = match[4] ? 30 : match[5] ? Number(match[5]) : match[3] ? Number(match[3]) : 0;
    tokens.push({ start: index, end: index + match[0].length, hint: match[1], hour: Number(match[2]), minute });
  }
  for (const match of text.matchAll(/正午/g)) {
    const index = match.index ?? 0;
    tokens.push({ start: index, end: index + match[0].length, hour: 12, minute: 0 });
  }
  return tokens.sort((a, b) => a.start - b.start);
}

interface TimeHit {
  span: Span;
  startTime: string;
  endTime?: string;
}

/** 開始と終了の組を作る。終わりが読めない・開始より前なら、開始だけにする。 */
function pairTimes(start: TimeToken, end: TimeToken | undefined): TimeHit | undefined {
  const startHour = resolveHour(start.hint, start.hour);
  if (startHour === undefined) return undefined;
  const startTime = toClock(startHour, start.minute);
  if (!startTime) return undefined;
  if (end) {
    // 「午後2時〜4時」の4時は午後。終わりの方に何も付いていなければ、開始の午後・夜を引き継ぐ。
    const endHint = end.hint ?? (start.hint && PM_HINTS.has(start.hint) && end.hour < 12 ? start.hint : undefined);
    const endHour = resolveHour(endHint, end.hour);
    const endTime = endHour === undefined ? undefined : toClock(endHour, end.minute);
    if (endTime && endTime > startTime) {
      return { span: { start: start.start, end: end.end }, startTime, endTime };
    }
  }
  return { span: { start: start.start, end: start.end }, startTime };
}

function readTime(text: string): TimeHit | undefined {
  const tokens = readTimeTokens(text);
  const first = tokens[0];
  if (!first) return undefined;

  // 「19時〜21時」「19:00-21:00」
  const second = tokens[1];
  if (second && ONLY_RANGE_SEPARATOR.test(text.slice(first.end, second.start))) {
    return pairTimes(first, second);
  }

  // 「19〜21時」「午後2〜4時」
  const before = text.slice(0, first.start);
  const bare = before.match(BARE_START_BEFORE);
  if (bare && bare.index !== undefined && !isDigit(before[bare.index - 1])) {
    const start: TimeToken = { start: bare.index, end: first.start, hint: bare[1], hour: Number(bare[2]), minute: 0 };
    const paired = pairTimes(start, first);
    if (paired?.endTime) return paired;
  }

  return pairTimes(first, undefined);
}

/** 取り除いた日時のすぐ後ろの、つなぎの言葉(「明日の」「19時から」「7時ごろに」)。
 * ひらがなの言葉の頭は削らない — 「明日のみかい」の「の」を削ると「みかい」になってしまう。 */
const TRAILING_LINK =
  /^\s*(?:頃|ごろ|くらい|ぐらい)?\s*(?:(?:までに|から|より|まで|の|に|は|、|,|〜|~|～)(?![ぁ-ゖ]))?\s*/;

function removeSpans(original: string, normalized: string, spans: Span[]): string {
  const removed = new Array<boolean>(original.length).fill(false);
  for (const span of spans) {
    const end = span.end + (normalized.slice(span.end).match(TRAILING_LINK)?.[0].length ?? 0);
    for (let i = span.start; i < end; i++) removed[i] = true;
  }

  // 日時が文の最後にある時だけ、その手前の「は」「、」も削る(「歯医者は明日19時」→「歯医者」)。
  // 途中にある時(「母は明日19時に帰る」)は文のまま残す。
  let last = original.length - 1;
  while (last >= 0 && (removed[last] || /\s/.test(original[last]))) last--;
  if (last >= 0 && removed.slice(last + 1).some(Boolean) && /[は、,]/.test(normalized[last])) {
    removed[last] = true;
  }

  // 取り除いた所の前後をつなぐ時は空白を1つ挟む(「歯医者明日19時カバン」→「歯医者 カバン」)。
  let rest = "";
  for (let i = 0; i < original.length; i++) {
    if (removed[i]) {
      if (i === 0 || !removed[i - 1]) rest += " ";
      continue;
    }
    rest += original[i];
  }
  return rest
    .replace(/[(（]\s*[)）]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * タイトルから日時を読み取る。日付も時刻も無ければ null。
 *
 * 日付・時刻はそれぞれ最初に書かれている1つだけを使う。2つ目以降はタイトルに残す —
 * 「明日と明後日」のような書き方をどちらと決めつけても、半分は間違えるため。
 */
export function parseTitleDateTime(title: string, today: string = todayStr()): TitleDateTime | null {
  const normalized = normalizeText(title);
  const base = parseISO(today);
  if (Number.isNaN(base.getTime())) return null;

  // 当たった所を伏せていく作業用の文。伏せた所は数字でなくなるので、後の規則も時刻も読まない。
  let masked = normalized;
  const mask = (span: Span) => {
    masked = masked.slice(0, span.start) + "\u0000".repeat(span.end - span.start) + masked.slice(span.end);
  };

  const dateHits: (Span & { date: string })[] = [];
  for (const rule of DATE_RULES) {
    for (const match of masked.matchAll(rule.pattern)) {
      const index = match.index ?? 0;
      if (rule.accept && !rule.accept(masked, index)) continue;
      const date = rule.read(match, base);
      if (!date) continue;
      let end = index + match[0].length;
      end += masked.slice(end).match(WEEKDAY_IN_PARENS)?.[0].length ?? 0;
      dateHits.push({ start: index, end, date });
    }
    for (const hit of dateHits) mask(hit);
  }
  const dateHit = dateHits.sort((a, b) => a.start - b.start)[0];
  const timeHit = readTime(masked);

  if (!dateHit && !timeHit) return null;

  const spans = [dateHit, timeHit?.span].filter((span): span is Span => Boolean(span));
  return {
    date: dateHit?.date,
    startTime: timeHit?.startTime,
    endTime: timeHit?.endTime,
    title: removeSpans(title, normalized, spans),
  };
}

/** 提案の文に出す日時(「10/13(火) 19:00」「10/13(火) 19:00〜21:00」)。年が違う時だけ年を付ける。 */
export function describeTitleDateTime(parsed: TitleDateTime, today: string = todayStr()): string {
  const parts: string[] = [];
  if (parsed.date) {
    const sameYear = parsed.date.slice(0, 4) === today.slice(0, 4);
    parts.push(format(parseISO(parsed.date), sameYear ? "M/d(E)" : "yyyy/M/d(E)", { locale: ja }));
  }
  if (parsed.startTime) {
    parts.push(
      parsed.endTime
        ? `${formatClock(parsed.startTime)}〜${formatClock(parsed.endTime)}`
        : formatClock(parsed.startTime),
    );
  }
  return parts.join(" ");
}
