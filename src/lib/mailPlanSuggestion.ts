import type { SyncedEmail } from "../types";
import { toDateStr, todayStr } from "./date";

/**
 * メールの件名と抜粋から、日時が書かれていそうかを見る。
 *
 * ここでAIは使わない。届いたメールを片っ端からAIに読ませると、読む気の無い
 * メールのぶんまで毎回API呼び出しが増えるため、「これは予定かもしれない」と
 * 当たりを付けるところまでは端末の中の文字合わせだけで済ませ、実際の読み取りは
 * 本人が「予定を追加」を押したときに1通ぶんだけ走らせる
 * (読み取り本体は既存の src/components/gmail/MailPlanImport.tsx)。
 *
 * 見ているのは件名と抜粋(snippet)だけ。本文は端末に持っていないため
 * (src/types/index.ts の SyncedEmail)、本文の奥に日時があるメールは拾えない。
 *
 * 日付は「そのメールが届いた日」を基準に実際の日に直す。「明日」「来週の火曜」は
 * それをしないと日付として数えられず、過ぎた候補を片付けることもできないため。
 */

/** 全角で書かれた数字や記号を半角に揃える。「１４時」「９／３」を取りこぼさないため。 */
function normalizeText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ":")
    .replace(/[／]/g, "/")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")");
}

/** Date#getDay と同じ並び。 */
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const MS_PER_DAY = 86_400_000;

function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shiftDays(base: Date, days: number): string {
  const shifted = atMidnight(base);
  shifted.setDate(shifted.getDate() + days);
  return toDateStr(shifted);
}

/** 年が書かれていない「9月3日」を、そのメールが届いた日に一番近い年に置く。
 *
 * 12月に届く「1月5日」は翌年、1月に届く「12月20日」は前年。単純に受信年を当てると、
 * 年をまたぐ案内が11か月先/前の日付になってしまう。 */
function withNearestYear(base: Date, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const baseDay = atMidnight(base);
  for (const year of [base.getFullYear(), base.getFullYear() + 1, base.getFullYear() - 1]) {
    const candidate = new Date(year, month - 1, day);
    // 「2月30日」のような日付はDateが繰り上げてしまうので、月がずれていないかで弾く。
    if (candidate.getMonth() !== month - 1) return undefined;
    const diffDays = (candidate.getTime() - baseDay.getTime()) / MS_PER_DAY;
    if (diffDays >= -45 && diffDays <= 320) return toDateStr(candidate);
  }
  return undefined;
}

/** 「20日(水)」のように日だけ書かれている場合。受信日から見て一番近いその日にする。 */
function withNearestMonth(base: Date, day: number): string | undefined {
  if (day < 1 || day > 31) return undefined;
  const baseDay = atMidnight(base);
  for (const monthOffset of [0, 1, -1]) {
    const candidate = new Date(base.getFullYear(), base.getMonth() + monthOffset, day);
    if (candidate.getDate() !== day) continue;
    const diffDays = (candidate.getTime() - baseDay.getTime()) / MS_PER_DAY;
    if (diffDays >= -20 && diffDays <= 40) return toDateStr(candidate);
  }
  return undefined;
}

/** 「今週の火曜」「来週火曜」。
 *
 * 「今週」と書かれていない時は、基準日以降で最初に来るその曜日。「来週」「再来週」は
 * 週(月曜はじまり)を数えてから曜日を当てる — 基準日から数えて7日足す作りだと、
 * 水曜に届いた「来週の火曜」が2週間後になってしまう(最初に来る火曜がもう翌週のため)。 */
function withWeekday(base: Date, weekday: number, weeksAhead: number): string {
  if (weeksAhead === 0) return shiftDays(base, (weekday - base.getDay() + 7) % 7);
  // 月曜を週のはじまりとして、その週の頭からの日数で数える。
  const fromMonday = (base.getDay() + 6) % 7;
  return shiftDays(base, -fromMonday + weeksAhead * 7 + ((weekday + 6) % 7));
}

interface DateRule {
  pattern: RegExp;
  read: (match: RegExpMatchArray, base: Date) => string | undefined;
}

/** 日付の見つけ方。上から順に当てて、当たったところは消してから次を当てる —
 * 「9月3日(水)」の「3日(水)」を別の日付として二重に数えないため。 */
const DATE_RULES: DateRule[] = [
  {
    // 「2026/9/3」「2026年9月3日」
    pattern: /(\d{4})\s*[/年.-]\s*(\d{1,2})\s*[/月.-]\s*(\d{1,2})\s*日?/g,
    read: (m) => {
      const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const candidate = new Date(year, month - 1, day);
      return candidate.getMonth() === month - 1 ? toDateStr(candidate) : undefined;
    },
  },
  // 「9月3日」
  { pattern: /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, read: (m, base) => withNearestYear(base, Number(m[1]), Number(m[2])) },
  // 「9/3」
  { pattern: /(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/g, read: (m, base) => withNearestYear(base, Number(m[1]), Number(m[2])) },
  // 「20日(水)」— 月をまたいだ案内で月を書かないメールがある。
  {
    pattern: /(\d{1,2})\s*日\s*\(\s*[月火水木金土日]\s*\)/g,
    read: (m, base) => withNearestMonth(base, Number(m[1])),
  },
  // 「本日」「明日」「明後日」。「当日」「翌日」は何の日を指すか分からない
  // (「当日は履歴書をお持ちください」など)ので日付として数えない。
  { pattern: /本日|今日/g, read: (_m, base) => shiftDays(base, 0) },
  { pattern: /明日|あした/g, read: (_m, base) => shiftDays(base, 1) },
  { pattern: /明後日|あさって/g, read: (_m, base) => shiftDays(base, 2) },
  // 「来週の火曜日」「今週金曜」「水曜日」
  {
    pattern: /(今週|来週|再来週)?\s*の?\s*([月火水木金土日])\s*曜日?/g,
    read: (m, base) =>
      withWeekday(base, WEEKDAYS.indexOf(m[2]), m[1] === "来週" ? 1 : m[1] === "再来週" ? 2 : 0),
  },
];

/** 「14:00」「14時30分」「午後2時」「10時半」。「1時間」は時刻ではないので外す。 */
const TIME_PATTERNS: RegExp[] = [
  /(午前|午後)?\s*\d{1,2}\s*:\s*\d{2}/,
  /(午前|午後)?\s*\d{1,2}\s*時(?!間)(\s*半|\s*\d{1,2}\s*分)?/,
];

/**
 * 予定になりやすいメールの言葉。日付だけで提案すると、請求書やお知らせまで
 * 引っかかるので、時刻か、この言葉のどれかが一緒にあるものだけを候補にする。
 */
const PLAN_KEYWORDS = [
  // 選考まわり(このアプリで実際に来るメールの中心)
  "面接",
  "面談",
  "選考",
  "説明会",
  "顔合わせ",
  "内定",
  "適性検査",
  "筆記",
  "試験",
  "インターン",
  "来社",
  "来訪",
  "訪問",
  "出社",
  "見学",
  // 日程そのものを指す言葉
  "日程",
  "日時",
  "予定",
  "スケジュール",
  "調整",
  "確定",
  "予約",
  "締切",
  "〆切",
  "期限",
  "提出",
  // 集まりの形
  "打ち合わせ",
  "打合せ",
  "ミーティング",
  "会議",
  "商談",
  "懇親",
  "会場",
  "開催",
  "実施",
  "集合",
  "受付",
  "出席",
  "参加",
  "オンライン",
  "Zoom",
  "zoom",
  "Teams",
  "Meet",
  // 旅行・移動(メールから旅程を起こす側で使う)
  "搭乗",
  "出発",
  "到着",
  "宿泊",
  "チェックイン",
];

/** 宣伝のメール。日付と「開催」「参加」が揃うので、上の言葉を広げたぶん
 * こちらで落とす(「本日開催のセール」など)。footerの定型文ではなく、
 * 抜粋の頭に出てくる売り文句だけを並べる。 */
const PROMO_KEYWORDS = ["セール", "キャンペーン", "クーポン", "割引", "抽選", "メルマガ", "無料プレゼント"];

export function isPromoText(text: string): boolean {
  const normalized = normalizeText(text);
  return PROMO_KEYWORDS.some((word) => normalized.includes(word));
}

export interface PlanSignals {
  hasDate: boolean;
  hasTime: boolean;
  /** 見つかった手がかり。提案の理由としてそのまま画面に出す。 */
  hints: string[];
  /** 読み取れた日付(YYYY-MM-DD)を古い順に。「明日」なども実際の日に直したもの。 */
  dates: string[];
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    // グローバルな正規表現は lastIndex を持ち回るので、都度作り直して使う。
    const match = text.match(new RegExp(pattern.source));
    if (match) return match[0].replace(/\s+/g, "");
  }
  return undefined;
}

/** 見つけた日付を「9月3日」の形にする。「明日」のままだと、一覧に並べたときに
 * 何日のことか分からないため、印には直した日付の方を出す。 */
function formatDateHint(dateStr: string): string {
  const [, month, day] = dateStr.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

/** 文章の中の日付を、書かれている順ではなく規則の順に読み取る。
 * 読み取れたところは空白に置き換えて、次の規則が同じ場所を二重に読まないようにする。 */
function readDates(text: string, base: Date): string[] {
  let rest = text;
  const dates: string[] = [];
  for (const rule of DATE_RULES) {
    const matches = [...rest.matchAll(rule.pattern)];
    if (matches.length === 0) continue;
    for (const match of matches) {
      const date = rule.read(match, base);
      if (date) dates.push(date);
    }
    rest = rest.replace(new RegExp(rule.pattern.source, "g"), " ");
  }
  return dates;
}

export function detectPlanSignals(text: string, receivedAt?: number): PlanSignals {
  const normalized = normalizeText(text);
  const base = receivedAt ? new Date(receivedAt) : new Date();
  const dates = [...new Set(readDates(normalized, base))].sort();
  const time = firstMatch(normalized, TIME_PATTERNS);
  const keyword = PLAN_KEYWORDS.find((word) => normalized.includes(word));
  // 印に出す日付は、書かれている中で一番早いもの(候補日が並ぶメールでは先頭の日)。
  const dateHint = dates.length > 0 ? formatDateHint(dates[0]) : undefined;
  return {
    hasDate: dates.length > 0,
    hasTime: Boolean(time),
    hints: [dateHint, time, keyword].filter((hint): hint is string => Boolean(hint)),
    dates,
  };
}

type SuggestionEmail = Pick<SyncedEmail, "subject" | "snippet" | "status"> & {
  receivedAt?: number;
  planSuggestionDismissedAt?: number;
  planText?: string;
};

/** 判定に使う文章。件名と抜粋に加えて、取り込んであれば本文の頭も見る
 * (src/lib/gmailSync.ts が入れる planText)。「日時は下記のとおり」と書いて実際の
 * 日時が抜粋の外に出るメールは、これが無いと1件も拾えない。 */
function planSourceText(email: Pick<SyncedEmail, "subject" | "snippet"> & { planText?: string }): string {
  return [email.subject, email.snippet, email.planText ?? ""].join(" ");
}

/** 本文の頭を取りに行く価値があるメールか(同期のときに使う)。
 *
 * 予定らしい言葉はあるのに抜粋からは日付が読めない、というメールだけを対象にする。
 * 全部のメールの本文を取り込むと、1通ごとにGmail APIをもう1回叩くうえ、広告メールの
 * 本文まで端末に溜まっていく。 */
export function needsPlanText(
  email: Pick<SyncedEmail, "subject" | "snippet" | "status"> & {
    planText?: string;
    planSuggestionDismissedAt?: number;
  },
): boolean {
  // 一度取りに行っていれば、空でもやり直さない。
  if (email.planText !== undefined) return false;
  if (email.planSuggestionDismissedAt) return false;
  if (email.status === "skipped") return false;
  const text = `${email.subject} ${email.snippet}`;
  if (isPromoText(text)) return false;
  if (!hasPlanKeyword(text)) return false;
  return !detectPlanSignals(text).hasDate;
}

/**
 * このメールを「予定を追加しますか?」として出すか。
 *
 * 日付が読み取れることが前提で、そのうえで時刻か予定らしい言葉があるもの。
 * 本人が「あとで」を押したメールと、スキップしたメールは出さない。
 * 返信を送り終えたメール(送信済み)は出す — 日程調整は「返信した時点で決まる」ので、
 * いちばん予定に入れたいメールがここで消えていた(2026-09-01)。
 * 書かれている日付がすべて過ぎているメールも出さない —
 * 済んだ面接の案内が「予定候補」に残り続けるため(2026-09-01)。
 * 宣伝のメール(PROMO_KEYWORDS)も、日付と言葉が揃ってしまうので出さない。
 */
export function isPlanSuggestion(email: SuggestionEmail, today: string = todayStr()): boolean {
  if (email.planSuggestionDismissedAt) return false;
  if (email.status === "skipped") return false;
  const text = planSourceText(email);
  if (isPromoText(text)) return false;
  const signals = detectPlanSignals(text, email.receivedAt);
  if (!signals.hasDate) return false;
  if (!signals.hasTime && !hasPlanKeyword(text)) return false;
  // 候補日が並ぶメールは、最後の1日が過ぎるまで残す。
  return signals.dates[signals.dates.length - 1] >= today;
}

export function hasPlanKeyword(text: string): boolean {
  const normalized = normalizeText(text);
  return PLAN_KEYWORDS.some((word) => normalized.includes(word));
}

/** 提案に添える一言。「9月3日・14:00・面接」のように、何を見つけたかを並べる。 */
export function planSuggestionHint(
  email: Pick<SyncedEmail, "subject" | "snippet"> & { receivedAt?: number; planText?: string },
): string {
  return detectPlanSignals(planSourceText(email), email.receivedAt).hints.join("・");
}

/** 提案として出せるメールだけを、新しい順に返す。 */
export function pickPlanSuggestions<T extends SuggestionEmail>(emails: T[], today: string = todayStr()): T[] {
  return emails.filter((email) => isPlanSuggestion(email, today));
}
