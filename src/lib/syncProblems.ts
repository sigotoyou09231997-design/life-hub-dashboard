import { useLiveQuery } from "dexie-react-hooks";
import { db, type SyncQueueEntry } from "../db/schema";

/**
 * 送れずに残っている変更(syncQueue で lastError が付いたもの)を、画面に出せる形にまとめる。
 *
 * 2026-09-21 に、本番で SQL 017/018 が流れていなかったため calendar_events の送信が
 * 「そんな列は無い」で弾かれ続け、しかも drainQueue が1件の失敗でそこから先を全部
 * 止めていたので、3週間以上すべての同期が止まっていた。失敗は console にしか出ず、
 * スマホでは誰も気づけなかった。ここはその「気づけない」を塞ぐためのもの。
 *
 * sync.ts は起動後に遅れて読み込まれる(syncRuntime)ので、ベルから使う表示用の
 * 部品はこちらに置き、sync.ts もここから名前と説明を借りる。
 */

const TABLE_LABELS: Record<string, string> = {
  transactions: "お金の記録",
  fixed_costs: "固定費",
  calendar_events: "予定",
  tasks: "タスク",
  notes: "メモ",
  salaries: "給与",
  trips: "旅行",
  trip_schedule: "旅行の日程",
  trip_expenses: "旅行の費用",
  trip_packing_items: "持ち物",
  trip_route_places: "旅行の経路",
  diary_entries: "日記",
  paypay_transactions: "PayPay",
  event_people: "予定の人",
  trip_expense_currencies: "旅行費用の通貨",
  transaction_project_tags: "案件タグ",
  category_budgets: "カテゴリ予算",
};

export function syncTableLabel(tableName: string): string {
  return TABLE_LABELS[tableName] ?? tableName;
}

/** Supabase のエラーを、何をすれば直るかが分かる一言にする。元の文言は detail に残す。 */
export function describeSyncError(raw: string): string {
  if (/42703|PGRST204|does not exist|Could not find the .* column/i.test(raw)) {
    return "本番のデータベースに列が足りません（supabase/sql の流し忘れ）";
  }
  if (/42P01|PGRST205|relation .* does not exist|Could not find the table/i.test(raw)) {
    return "本番のデータベースに表がありません（supabase/sql の流し忘れ）";
  }
  if (/23502|null value in column/i.test(raw)) return "本番のデータベースが必須にしている項目が空です";
  if (/42501|row-level security/i.test(raw)) return "サーバーに書き込む権限がありません（ログインし直すと直ることがあります）";
  return "サーバーに受け付けてもらえませんでした";
}

export interface SyncProblem {
  table: string;
  label: string;
  count: number;
  message: string;
  detail: string;
}

export function summarizeSyncProblems(entries: SyncQueueEntry[]): SyncProblem[] {
  const byTable = new Map<string, SyncProblem>();
  for (const entry of entries) {
    if (!entry.lastError) continue;
    const current = byTable.get(entry.table);
    if (current) {
      current.count += 1;
    } else {
      byTable.set(entry.table, {
        table: entry.table,
        label: syncTableLabel(entry.table),
        count: 1,
        message: describeSyncError(entry.lastError),
        detail: entry.lastError,
      });
    }
  }
  return [...byTable.values()];
}

const NONE: SyncProblem[] = [];

export function useSyncProblems(): SyncProblem[] {
  return (
    useLiveQuery(async () => summarizeSyncProblems(await db.syncQueue.filter((entry) => !!entry.lastError).toArray()), []) ??
    NONE
  );
}
