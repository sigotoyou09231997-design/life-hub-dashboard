import { db } from "../db/schema";

type SyncModule = typeof import("./sync");

let modulePromise: Promise<SyncModule> | null = null;
let loadedModule: SyncModule | null = null;
let desiredUserId: string | null = null;

function loadSyncModule(): Promise<SyncModule> {
  if (!modulePromise) {
    modulePromise = import("./sync")
      .then((module) => {
        loadedModule = module;
        module.registerSyncedTable(db.transactions, "transactions");
        module.registerSyncedTable(db.fixedCosts, "fixed_costs");
        module.registerSyncedTable(db.calendarEvents, "calendar_events");
        module.registerSyncedTable(db.tasks, "tasks");
        module.registerSyncedTable(db.notes, "notes");
        module.registerSyncedTable(db.salaries, "salaries");
        module.registerSyncedTable(db.trips, "trips");
        module.registerSyncedTable(db.tripSchedule, "trip_schedule");
        module.registerSyncedTable(db.tripExpenses, "trip_expenses");
        module.registerSyncedTable(db.tripPackingItems, "trip_packing_items");
        module.registerSyncedTable(db.tripRoutePlaces, "trip_route_places");
        module.registerSyncedTable(db.diaryEntries, "diary_entries");
        module.registerSyncedTable(db.paypayTransactions, "paypay_transactions");
        module.registerSyncedTable(db.eventPeople, "event_people");
        // 2026-09-04、本人が supabase/sql/021・022 を本番で流したという連絡を受けて登録した。
        // テーブルが先、登録があと(逆順だと無いテーブルへ upsert して同期が止まる)。
        module.registerSyncedTable(db.tripExpenseCurrencies, "trip_expense_currencies");
        module.registerSyncedTable(db.transactionProjectTags, "transaction_project_tags");
        // 2026-09-05、本人が supabase/sql/024 を本番で流したという連絡を受けて登録した。
        // これで、アプリを開いていない日でも使いすぎ予測を Web Push で送れる
        // (netlify/functions/checkBudgetAndNotify.ts から上限が見えるようになるため)。
        module.registerSyncedTable(db.categoryBudgets, "category_budgets");
        return module;
      })
      .catch((error) => {
        modulePromise = null;
        throw error;
      });
  }
  return modulePromise;
}

export async function startSync(userId: string, accessToken: string): Promise<void> {
  desiredUserId = userId;
  const module = await loadSyncModule();
  if (desiredUserId !== userId) return;
  await module.startSession(userId, accessToken);
  if (desiredUserId !== userId) module.stopSession();
}

export function stopSync(): void {
  desiredUserId = null;
  loadedModule?.stopSession();
}

export async function syncNow(): Promise<string> {
  const module = await loadSyncModule();
  return module.syncNow();
}
