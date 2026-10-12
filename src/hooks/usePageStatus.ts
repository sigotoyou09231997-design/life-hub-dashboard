import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import { todayStr } from "../lib/date";
import { occursOn } from "../lib/eventSpan";
import { getNoteType } from "../lib/noteTypes";
import { expenseStatusText, notesStatusText, scheduleStatusText, tripsStatusText } from "../lib/pageStatus";
import { usePayPeriodBudget } from "./usePayPeriodBudget";
import { useWithoutPendingDeletes } from "./usePendingDeletes";

/**
 * ページの見出しの下の「いまの状態」の1行(src/lib/pageStatus.ts)。読み込み中は undefined
 * (見出しの高さは PageHeader が空の1行で確保するので、出てきても画面が下へずれない)。
 * どれも、ホームや各画面が使っているのと同じ数え方(削除を取り消せる間のものは数えない)。
 */

export function useScheduleStatus(): string | undefined {
  const today = todayStr();
  const events = useWithoutPendingDeletes(
    "calendarEvents",
    useLiveQuery(() => db.calendarEvents.filter((event) => occursOn(event, today)).toArray(), [today]),
  );
  const tasks = useWithoutPendingDeletes(
    "tasks",
    useLiveQuery(() => db.tasks.where("dueDate").equals(today).toArray(), [today]),
  );
  if (events === undefined || tasks === undefined) return undefined;
  const todayTasks = tasks.filter((task) => !task.parentTaskId);
  const open = todayTasks.filter((task) => !task.completed).length;
  return scheduleStatusText(events.length, open, todayTasks.length);
}

export function useExpenseStatus(): string | undefined {
  const { data: budget, loading } = usePayPeriodBudget();
  const today = todayStr();
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthTotal = useLiveQuery(async () => {
    const rows = await db.transactions.where("date").between(monthStart, today, true, true).toArray();
    return rows.filter((row) => row.type === "expense").reduce((sum, row) => sum + row.amount, 0);
  }, [monthStart, today]);
  if (loading || monthTotal === undefined) return undefined;
  // 給与が登録されていれば、その期間の支出と給料日までの日数。無ければ、今月の支出だけ。
  return budget
    ? expenseStatusText(budget.actualSpending, budget.period.daysUntilNextPayday)
    : expenseStatusText(monthTotal, null);
}

export function useNotesStatus(): string | undefined {
  const notes = useWithoutPendingDeletes(
    "notes",
    useLiveQuery(() => db.notes.toArray(), []),
  );
  if (notes === undefined) return undefined;
  // type は、メモ・チェックリスト・買い物の分け方ができる前のメモには無い。画面と同じ getNoteType で読む(無ければメモ)。
  const count = (type: "memo" | "checklist" | "shopping") => notes.filter((note) => getNoteType(note) === type).length;
  return notesStatusText({ memo: count("memo"), checklist: count("checklist"), shopping: count("shopping") });
}

export function useTripsStatus(): string | undefined {
  const trips = useLiveQuery(() => db.trips.toArray(), []);
  if (trips === undefined) return undefined;
  return tripsStatusText(trips.map((trip) => trip.status));
}
