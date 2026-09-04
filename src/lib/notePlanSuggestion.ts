import { detectPlanSignals, hasPlanKeyword } from "./mailPlanSuggestion";
import { todayStr } from "./date";

/**
 * メモの本文から「予定に追加しますか?」の候補を作る。
 *
 * 判定そのものはメールの提案(src/lib/mailPlanSuggestion.ts)をそのまま使う —
 * 日付・時刻の書き方はメールもメモも同じで、2つ持つと片方だけ直す事故になる。
 * 違うのは次の2点。
 *
 *  - 宣伝メールよけ(PROMO_KEYWORDS)は掛けない。自分で書いたメモに広告は入らない。
 *  - 過ぎた日付は候補にしない。メールと違って「もう済んだ案内」を残す理由が無い。
 */

/** 全角の数字と記号を半角に。mailPlanSuggestion 側と同じ扱いにする。 */
function normalizeText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ":");
}

/**
 * 「14:00」「午後2時」「10時半」「9時30分」を HH:mm にする。読めなければ undefined。
 * 時刻が読めなくても日付だけで候補にはするので、ここは分かる時だけ埋める欄。
 */
export function parseTimeText(text: string): string | undefined {
  const normalized = normalizeText(text);
  const match = normalized.match(/(午前|午後)?\s*(\d{1,2})\s*(?::\s*(\d{1,2})|時(?!間)\s*(?:(半)|(\d{1,2})\s*分)?)/);
  if (!match) return undefined;

  const [, meridiem, hourText, colonMinutes, half, kanjiMinutes] = match;
  let hour = Number(hourText);
  const minute = half ? 30 : Number(colonMinutes ?? kanjiMinutes ?? 0);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
  if (minute > 59) return undefined;

  if (meridiem === "午後" && hour < 12) hour += 12;
  if (meridiem === "午前" && hour === 12) hour = 0;
  if (hour > 23) return undefined;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export interface NotePlanSuggestion {
  /** YYYY-MM-DD。本文から読み取れた中でいちばん早い、まだ過ぎていない日。 */
  date: string;
  /** HH:mm。読み取れた時だけ。 */
  time?: string;
  /** 「9月3日・14:00・打ち合わせ」のような、何を見つけたかの一言。 */
  hint: string;
}

/**
 * 本文から予定の候補を1つ作る。候補にしないときは null。
 *
 * メールと同じで、日付が読み取れることが前提。そのうえで時刻か、予定らしい言葉
 * (PLAN_KEYWORDS)のどちらかがあるものだけを出す — 日付だけで出すと、
 * 買った物のメモや記録の日付にまで反応する。
 */
export function detectNotePlan(body: string, today: string = todayStr(), base: Date = new Date()): NotePlanSuggestion | null {
  if (!body.trim()) return null;
  const signals = detectPlanSignals(body, base.getTime());
  if (!signals.hasDate) return null;
  if (!signals.hasTime && !hasPlanKeyword(body)) return null;

  // 過ぎた日は落とす。全部過ぎていれば候補にしない。
  const upcoming = signals.dates.filter((date) => date >= today);
  if (upcoming.length === 0) return null;

  const date = upcoming[0];
  const timeHint = signals.hints.find((hint) => parseTimeText(hint) !== undefined);
  return {
    date,
    time: timeHint ? parseTimeText(timeHint) : undefined,
    hint: signals.hints.join("・"),
  };
}
