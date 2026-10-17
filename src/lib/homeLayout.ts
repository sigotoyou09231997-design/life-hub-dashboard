import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import { toDateStr } from "./date";

/**
 * ホーム(TOP)の組み直し(Cowork「LIFE HUB ホームのレイアウト案」2026-10-16、実装 2026-10-17)。
 * 8ブロック・縦約1,000px だったホームを、4ブロック・1画面に収める。
 *   1. 今日の1行(日付＋状態)
 *   2. お金(黒)＋気になること(白)
 *   3. 今日と、この先(今日・明日・明後日の予定とタスク)
 *   4. 次の旅行(写真)＋Gmail(白)
 * 外したもの: 今日のまとめ(予定・重要な未読は下のカードと重なる)、最近使われていない機能(暮らしの情報ではない)、
 * LIFE HUB をそろえる(残りは「気になること」の行に入れる)。
 * ここは「何を出すか」の決め方だけ(通信も描画もしない)。
 */

/** 「今日と、この先」に出す日数(今日を含む)。 */
export const AHEAD_DAYS = 3;
/** 次の旅行を大きな写真のカードで出す、出発までの日数の上限。これより先は1行の帯。 */
export const TRIP_BIG_WITHIN_DAYS = 30;

export function aheadDates(today: string, days = AHEAD_DAYS): string[] {
  const base = parseISO(today);
  return Array.from({ length: days }, (_, i) => toDateStr(addDays(base, i)));
}

/** 「今日」「明日」「明後日」。それより先は空(日付だけ出す)。 */
export function aheadDayLabel(date: string, today: string): string {
  const diff = differenceInCalendarDays(parseISO(date), parseISO(today));
  return ["今日", "明日", "明後日"][diff] ?? "";
}

/** 日付の下に出す今日の状態の一言。見出しは「何が」ではなく「状態」(第5弾 C-4 と同じ考え方)。 */
export function homeStatusLine(eventCount: number | undefined, openTasks: number | undefined): string {
  if (eventCount === undefined || openTasks === undefined) return "";
  const parts = [eventCount > 0 ? `予定${eventCount}件` : "", openTasks > 0 ? `タスク${openTasks}件` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join("・") : "今日は予定もタスクもありません";
}

export type TripCardMode = "big" | "band";

/** 旅行中か、出発まで30日以内なら大きな写真のカード。それ以外(72日先など)は毎日見る情報ではないので1行の帯。 */
export function tripCardMode(trip: { status: string; startDate: string; endDate: string } | undefined, today: string): TripCardMode {
  if (!trip) return "band";
  if (trip.status === "ongoing") return "big";
  if (trip.startDate <= today && today <= trip.endDate) return "big";
  const days = differenceInCalendarDays(parseISO(trip.startDate), parseISO(today));
  return days >= 0 && days <= TRIP_BIG_WITHIN_DAYS ? "big" : "band";
}

export interface Concern {
  id: string;
  /** 赤＝放っておくと困る(返信待ち・予算超え・期限切れ)。琥珀＝設定が未完(住所・連携)。 */
  tone: "red" | "amber";
  text: string;
  note?: string;
  /** 押せる所の文字(青緑)。 */
  cta: string;
  to?: string;
  action?: "expense" | "event";
}

export interface ConcernInput {
  /** 返信待ち(src/lib/replyWaiting.ts)。待っている日数の長い順。 */
  waiting: { emailId: string; name: string; waitingDays: number }[];
  /** 今のペースだと給料日までに超えそうなカテゴリ予算。 */
  forecasts: { category: string; projectedOver: number }[];
  /** 期限を過ぎた未完了のタスクの数。 */
  overdueTasks: number;
  /** 連携が切れている Gmail のアカウント。 */
  reauthEmails: string[];
  /** 「LIFE HUB をそろえる」のまだ済んでいない項目。 */
  setupItems: { id: string; label: string; to?: string; action?: "expense" | "event" }[];
}

/** 「気になること」の行。赤(放っておくと困る)を先に、琥珀(設定が未完)を後に。無ければ空(カードを出さない)。 */
export function buildConcerns(input: ConcernInput): Concern[] {
  const rows: Concern[] = [];
  for (const item of input.waiting) {
    rows.push({
      id: `waiting:${item.emailId}`,
      tone: "red",
      text: `${item.name} からの返信を ${item.waitingDays}日待っています`,
      cta: "開く",
      to: `/gmail/mail/${item.emailId}`,
    });
  }
  for (const forecast of input.forecasts) {
    rows.push({
      id: `budget:${forecast.category}`,
      tone: "red",
      text: `${forecast.category}が給料日までに予算を超えそう`,
      note: `このままだと約¥${Math.round(forecast.projectedOver).toLocaleString()}超え`,
      cta: "支出を見る",
      to: "/records/expense",
    });
  }
  if (input.overdueTasks > 0) {
    rows.push({ id: "overdue", tone: "red", text: `期限を過ぎたタスクが ${input.overdueTasks}件`, cta: "見る", to: "/schedule?view=list" });
  }
  for (const email of input.reauthEmails) {
    rows.push({ id: `reauth:${email}`, tone: "amber", text: `${email} の連携が切れています`, cta: "つなぐ", to: "/settings" });
  }
  for (const item of input.setupItems) {
    rows.push({ id: `setup:${item.id}`, tone: "amber", text: item.label, cta: "入れる", to: item.to, action: item.action });
  }
  return rows;
}
