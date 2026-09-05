import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import type { SyncedEmail, Task, Transaction } from "../types";
import { isOverdue, toDateStr, todayStr } from "./date";
import { parseSender } from "./gmail";
import {
  forecastOverBudget,
  spendingByCategory,
  summarizeCategoryBudgets,
  type CategoryBudgetForecast,
} from "./categoryBudget";
import { payPeriodProgress, resolveCurrentPeriod } from "./payPeriod";

const GMAIL_PREVIEW_LIMIT = 5;

export interface NotificationSignals {
  gmailUnprocessed: SyncedEmail[];
  overdueTasks: Task[];
  /** まだ超えていないが、今のペースだと給料日までに超えそうなカテゴリ予算。
   * 2026-09-05 に category_budgets を同期の対象にしたので、同じ内容は
   * サーバーからの Web Push でも届く(netlify/functions/checkBudgetAndNotify.ts)。
   * 式も足切りも src/lib/categoryBudget.ts の forecastFor に揃えてあり、
   * ここで見える警告と届く通知は食い違わない。 */
  budgetForecasts: CategoryBudgetForecast[];
  total: number;
}

const EMPTY: NotificationSignals = { gmailUnprocessed: [], overdueTasks: [], budgetForecasts: [], total: 0 };

/** カテゴリ予算の使いすぎ予測。給与の履歴が無い(＝期が決まらない)ときは何も出さない。 */
async function loadBudgetForecasts(): Promise<CategoryBudgetForecast[]> {
  const [budgets, salaries] = await Promise.all([db.categoryBudgets.toArray(), db.salaries.toArray()]);
  if (budgets.length === 0) return [];
  const period = resolveCurrentPeriod(salaries, new Date());
  if (!period) return [];

  const transactions: Transaction[] = await db.transactions
    .where("date")
    .between(toDateStr(period.periodStart), todayStr(), true, true)
    .toArray();
  const statuses = summarizeCategoryBudgets(budgets, spendingByCategory(transactions));
  const { elapsedDays, remainingDays } = payPeriodProgress(period);
  return forecastOverBudget(statuses, elapsedDays, remainingDays);
}

/** Aggregates the app's "needs your attention" signals for the header bell:
 * unprocessed Gmail (blocked senders excluded, same rule as GmailInbox) and
 * overdue tasks. There's no persisted notification-center table — this is
 * computed live from the same data the Gmail/Schedule screens already show. */
export function useNotificationSignals(): NotificationSignals {
  const result = useLiveQuery(async () => {
    const [unprocessedEmails, blockedSenders, tasks, budgetForecasts] = await Promise.all([
      db.syncedEmails.where("status").equals("unprocessed").reverse().sortBy("receivedAt"),
      db.blockedSenders.toArray(),
      db.tasks.toArray(),
      loadBudgetForecasts(),
    ]);
    const blockedSet = new Set(blockedSenders.map((b) => b.email));
    const gmailUnprocessed = unprocessedEmails
      .filter((e) => !blockedSet.has(parseSender(e.from).email.toLowerCase()))
      .slice(0, GMAIL_PREVIEW_LIMIT);
    const overdueTasks = tasks.filter((t) => !t.completed && isOverdue(t.dueDate, t.dueTime));
    return {
      gmailUnprocessed,
      overdueTasks,
      budgetForecasts,
      total: gmailUnprocessed.length + overdueTasks.length + budgetForecasts.length,
    };
  }, []);

  return result ?? EMPTY;
}
