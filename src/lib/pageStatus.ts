import type { TripStatus } from "../types";

/**
 * ページの見出しの下に出す「いまの状態」の1行(UI/UX 調査メモ 第5弾 C-4、2026-10-13)。
 * 見出しを読むだけで、その画面のいまの状況が分かるように。文を作るだけの純粋な関数で、データを読むのは
 * src/hooks/usePageStatus.ts。
 */

/** 予定・タスク: 「今日は予定0件・未完了のタスク0件」。タスクを全部済ませた日は「タスクは全部完了」。 */
export function scheduleStatusText(eventCount: number, openTasks: number, totalTasks: number): string {
  const tasks = totalTasks > 0 && openTasks === 0 ? "タスクは全部完了" : `未完了のタスク${openTasks}件`;
  return `今日は予定${eventCount}件・${tasks}`;
}

/** お金管理: 「今月の支出 ¥0・給料日まで20日」。給与が未登録なら支出だけ。 */
export function expenseStatusText(spent: number, daysUntilPayday: number | null): string {
  const base = `今月の支出 ¥${Math.round(spent).toLocaleString()}`;
  return daysUntilPayday === null ? base : `${base}・給料日まで${daysUntilPayday}日`;
}

/** メモ・リスト: 「メモ 2・チェックリスト 1・買い物リスト 0」。1つも無ければ「まだ何もありません」。 */
export function notesStatusText(counts: { memo: number; checklist: number; shopping: number }): string {
  if (counts.memo + counts.checklist + counts.shopping === 0) return "まだ何もありません";
  return `メモ ${counts.memo}・チェックリスト ${counts.checklist}・買い物リスト ${counts.shopping}`;
}

/** 旅行計画: 「旅行中 1件・計画中 2件・完了 3件」(0件の状態は省く)。1つも無ければ「まだ旅行はありません」。 */
export function tripsStatusText(statuses: TripStatus[]): string {
  const count = (status: TripStatus) => statuses.filter((s) => s === status).length;
  const parts = [
    ["旅行中", count("ongoing")],
    ["計画中", count("planning")],
    ["完了", count("completed")],
  ].filter(([, n]) => (n as number) > 0).map(([label, n]) => `${label} ${n}件`);
  return parts.length > 0 ? parts.join("・") : "まだ旅行はありません";
}
