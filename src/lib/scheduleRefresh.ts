import { db } from "../db/schema";
import type { GmailAccount } from "../types";
import {
  hasCalendarScope,
  isCalendarSyncEnabled,
  summarizeCalendarSync,
  syncGoogleCalendar,
  type CalendarSyncResult,
} from "./googleCalendar";
import { syncNow } from "./syncRuntime";

/**
 * 予定・タスクの画面で「引っ張って更新」した時に走らせる同期(UI/UX 調査メモ 第4弾 A-7)。
 *
 * この画面には専用の「今すぐ同期」ボタンが無いので、ほかの画面で同じ意味のボタンがしている2つを走らせる:
 * - PC・スマホの間の同期(アカウント画面の「今すぐ同期」と同じ syncNow)。予定・タスクの行を取り込み直し、
 *   送れていない変更を送る。リアルタイムの接続はスマホが裏に回ると黙って切れることがあるので、
 *   開き直した時に引っ張れば、ほかの端末で足した予定がすぐ届く。
 * - Googleカレンダーの取り込み(設定画面の「今すぐ取り込む」と同じ syncGoogleCalendar)。
 *   取り込みを入にしてあるアカウントだけ。開いた時の自動の取り込みは10分に1回までだが、引っ張った時は待たない。
 */
export async function refreshScheduleSources(): Promise<ScheduleRefreshSummary> {
  const accounts = await db.gmailAccounts.toArray();
  const [cloud, calendars] = await Promise.all([
    syncNow().then(
      (message) => ({ message, failed: false }),
      (err: unknown) => ({ message: `同期に失敗しました: ${err instanceof Error ? err.message : String(err)}`, failed: true }),
    ),
    Promise.all(accounts.filter(canPullCalendar).map((account) => syncGoogleCalendar(account))),
  ]);
  return describeScheduleRefresh(cloud, calendars);
}

/** 引っ張った時に取り込みを走らせるアカウント(入にしてある・権限がある・連携が切れていない)。 */
export function canPullCalendar(account: GmailAccount): boolean {
  return isCalendarSyncEnabled(account) && hasCalendarScope(account) && !account.reauthRequiredAt;
}

export interface ScheduleRefreshSummary {
  message: string;
  tone: "success" | "error";
}

/**
 * お知らせ1行にまとめる。端末間の同期の結果を先に、Googleカレンダーは「何か変わった」か「失敗した」時だけ足す
 * (変更なしまで並べると、引っ張るたびに長い文になる)。
 */
export function describeScheduleRefresh(
  cloud: { message: string; failed: boolean },
  calendars: CalendarSyncResult[],
): ScheduleRefreshSummary {
  const calendarNotes = calendars
    .filter((r) => r.error || r.baselined || r.added || r.updated || r.deleted)
    .map((r) => summarizeCalendarSync(r));
  const failed = cloud.failed || calendars.some((r) => r.error);
  return { message: [cloud.message, ...calendarNotes].join(" / "), tone: failed ? "error" : "success" };
}
