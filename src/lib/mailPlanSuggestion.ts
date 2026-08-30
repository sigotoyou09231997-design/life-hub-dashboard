import type { SyncedEmail } from "../types";

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
 */

/** 「9月3日」「2026/9/3」「9/3」。 */
const DATE_PATTERNS: RegExp[] = [
  /\d{1,2}\s*月\s*\d{1,2}\s*日/g,
  /\d{4}\s*[/年-]\s*\d{1,2}\s*[/月-]\s*\d{1,2}/g,
  /\d{1,2}\/\d{1,2}/g,
];

/** 「14:00」「14時」「14時30分」。 */
const TIME_PATTERNS: RegExp[] = [/\d{1,2}\s*:\s*\d{2}/g, /\d{1,2}\s*時(\s*\d{1,2}\s*分)?/g];

/**
 * 予定になりやすいメールの言葉。日付だけで提案すると、請求書やお知らせまで
 * 引っかかるので、時刻か、この言葉のどれかが一緒にあるものだけを候補にする。
 */
const PLAN_KEYWORDS = [
  "面接",
  "面談",
  "選考",
  "説明会",
  "日程",
  "日時",
  "予約",
  "確定",
  "来社",
  "会場",
  "開催",
  "打ち合わせ",
  "打合せ",
  "集合",
  "出席",
  "参加",
];

export interface PlanSignals {
  hasDate: boolean;
  hasTime: boolean;
  /** 見つかった手がかり。提案の理由としてそのまま画面に出す。 */
  hints: string[];
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    // グローバルな正規表現は lastIndex を持ち回るので、都度作り直して使う。
    const match = text.match(new RegExp(pattern.source));
    if (match) return match[0].replace(/\s+/g, "");
  }
  return undefined;
}

export function detectPlanSignals(text: string): PlanSignals {
  const date = firstMatch(text, DATE_PATTERNS);
  const time = firstMatch(text, TIME_PATTERNS);
  const keyword = PLAN_KEYWORDS.find((word) => text.includes(word));
  return {
    hasDate: Boolean(date),
    hasTime: Boolean(time),
    hints: [date, time, keyword].filter((hint): hint is string => Boolean(hint)),
  };
}

type SuggestionEmail = Pick<SyncedEmail, "subject" | "snippet" | "status"> & {
  planSuggestionDismissedAt?: number;
};

/**
 * このメールを「予定を追加しますか?」として出すか。
 *
 * 日付が読み取れることが前提で、そのうえで時刻か予定らしい言葉があるもの。
 * 返信を送り終えたメールと、本人が「あとで」を押したメールは出さない。
 */
export function isPlanSuggestion(email: SuggestionEmail): boolean {
  if (email.planSuggestionDismissedAt) return false;
  if (email.status === "sent" || email.status === "skipped") return false;
  const signals = detectPlanSignals(`${email.subject} ${email.snippet}`);
  return signals.hasDate && (signals.hasTime || hasPlanKeyword(`${email.subject} ${email.snippet}`));
}

export function hasPlanKeyword(text: string): boolean {
  return PLAN_KEYWORDS.some((word) => text.includes(word));
}

/** 提案に添える一言。「9月3日・14:00・面接」のように、何を見つけたかを並べる。 */
export function planSuggestionHint(email: Pick<SyncedEmail, "subject" | "snippet">): string {
  return detectPlanSignals(`${email.subject} ${email.snippet}`).hints.join("・");
}

/** 提案として出せるメールだけを、新しい順に返す。 */
export function pickPlanSuggestions<T extends SuggestionEmail>(emails: T[]): T[] {
  return emails.filter(isPlanSuggestion);
}
