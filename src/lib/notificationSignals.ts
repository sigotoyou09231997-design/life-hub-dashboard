import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import type { SyncedEmail, Task } from "../types";
import { isOverdue } from "./date";
import { parseSender } from "./gmail";

const GMAIL_PREVIEW_LIMIT = 5;

export interface NotificationSignals {
  gmailUnprocessed: SyncedEmail[];
  overdueTasks: Task[];
  total: number;
}

const EMPTY: NotificationSignals = { gmailUnprocessed: [], overdueTasks: [], total: 0 };

/** Aggregates the app's "needs your attention" signals for the header bell:
 * unprocessed Gmail (blocked senders excluded, same rule as GmailInbox) and
 * overdue tasks. There's no persisted notification-center table — this is
 * computed live from the same data the Gmail/Schedule screens already show. */
export function useNotificationSignals(): NotificationSignals {
  const result = useLiveQuery(async () => {
    const [unprocessedEmails, blockedSenders, tasks] = await Promise.all([
      db.syncedEmails.where("status").equals("unprocessed").reverse().sortBy("receivedAt"),
      db.blockedSenders.toArray(),
      db.tasks.toArray(),
    ]);
    const blockedSet = new Set(blockedSenders.map((b) => b.email));
    const gmailUnprocessed = unprocessedEmails
      .filter((e) => !blockedSet.has(parseSender(e.from).email.toLowerCase()))
      .slice(0, GMAIL_PREVIEW_LIMIT);
    const overdueTasks = tasks.filter((t) => !t.completed && isOverdue(t.dueDate, t.dueTime));
    return { gmailUnprocessed, overdueTasks, total: gmailUnprocessed.length + overdueTasks.length };
  }, []);

  return result ?? EMPTY;
}
