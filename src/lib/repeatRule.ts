import type { RepeatRule } from "../types";

/**
 * 曜日指定の繰り返し("毎週 月・水・金だけ")。
 *
 * 予定・タスクの repeat は、Supabase 側では calendar_events.repeat / tasks.repeat の
 * text 列そのままで同期される(supabase/sql/002・017)。曜日を別の列に分けると
 * SQL の追加が要るので、代わりに **同じ text の中に "weekdays:1,3,5" と書く**。
 * 0=日曜〜6=土曜(JSの Date#getDay と同じ並び)。
 *
 * この形を知らない古いアプリがこの値を読んだ場合は、どの分岐にも当たらず
 * 「繰り返さない予定」として扱われる — 予定そのものは初日に出たまま残るので、
 * 表示が減るだけで壊れはしない。
 */
const WEEKDAY_PREFIX = "weekdays:";

/** 0=日〜6=土。カレンダーの見出しと同じ並びにしてある。 */
export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 決め打ちの選択肢(曜日指定より前からあるもの)。 */
export type RepeatPreset = Extract<RepeatRule, "none" | "daily" | "weekly" | "monthly">;

/** 選んだ曜日から repeat の文字列を作る。1つも選ばなければ "none"。 */
export function makeWeekdayRepeat(days: readonly number[]): RepeatRule {
  const normalized = [...new Set(days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  if (normalized.length === 0) return "none";
  return `${WEEKDAY_PREFIX}${normalized.join(",")}` as RepeatRule;
}

/**
 * repeat から曜日の一覧を取り出す。曜日指定でなければ null。
 * 壊れた値("weekdays:"だけ、"weekdays:9" など)も、拾える曜日が1つも無ければ null に落とす —
 * 半端な指定を「毎日」や「繰り返さない」に化けさせるより、単発として扱う方が安全。
 */
export function parseWeekdayRepeat(repeat: RepeatRule | undefined): number[] | null {
  if (!repeat || !repeat.startsWith(WEEKDAY_PREFIX)) return null;
  const days = repeat
    .slice(WEEKDAY_PREFIX.length)
    .split(",")
    .map((part) => part.trim())
    // 空の欄を先に落とす。Number("") は 0(＝日曜)なので、"weekdays:" だけの
    // 壊れた値が「毎週日曜」に化けてしまう。
    .filter((part) => part !== "")
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const unique = [...new Set(days)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : null;
}

/** 繰り返す設定か(単発・未設定・壊れた曜日指定は false)。 */
export function isRepeating(repeat: RepeatRule | undefined): boolean {
  if (!repeat || repeat === "none") return false;
  if (repeat === "daily" || repeat === "weekly" || repeat === "monthly") return true;
  return parseWeekdayRepeat(repeat) !== null;
}

/** 一覧のバッジに出す短い文字。曜日指定だけは、どの曜日かまで出す。 */
export function repeatLabel(repeat: RepeatRule | undefined): string {
  const weekdays = parseWeekdayRepeat(repeat);
  if (weekdays) return `毎週${weekdays.map((d) => WEEKDAY_LABELS[d]).join("・")}`;
  switch (repeat) {
    case "daily":
      return "毎日";
    case "weekly":
      return "毎週";
    case "monthly":
      return "毎月";
    default:
      return "";
  }
}
