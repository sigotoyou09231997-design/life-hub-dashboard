import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ja } from "date-fns/locale";
import type { CalendarEvent, DiaryEntry, Note, Task, Transaction } from "../types";
import { toDateStr } from "./date";

export type ReviewSpan = "week" | "month";

export interface ReviewPeriod {
  span: ReviewSpan;
  /** YYYY-MM-DD、期間の初日(週は月曜)。 */
  start: string;
  /** YYYY-MM-DD、期間の最終日(両端を含む)。 */
  end: string;
  /** 見出しに出す文字。週は「8月25日〜8月31日」、月は「2026年8月」。 */
  label: string;
  /** 0が今週・今月、-1が1つ前。画面の「前へ/次へ」がこの値を動かす。 */
  offset: number;
}

/**
 * 見ている期間を決める。offsetは0が今週(今月)で、負の数だけ過去へ戻る。
 * 週の始まりは月曜 — カレンダー(src/lib/date.ts の weekRange)と揃える。
 */
export function resolveReviewPeriod(span: ReviewSpan, offset: number, base: Date = new Date()): ReviewPeriod {
  const anchor = span === "week" ? addWeeks(base, offset) : addMonths(base, offset);
  const start = span === "week" ? startOfWeek(anchor, { weekStartsOn: 1 }) : startOfMonth(anchor);
  const end = span === "week" ? endOfWeek(anchor, { weekStartsOn: 1 }) : endOfMonth(anchor);
  const label =
    span === "week"
      ? `${format(start, "M月d日", { locale: ja })}〜${format(end, "M月d日", { locale: ja })}`
      : format(anchor, "yyyy年M月");
  return { span, start: toDateStr(start), end: toDateStr(end), label, offset };
}

function inPeriod(date: string | undefined, period: ReviewPeriod): boolean {
  if (!date) return false;
  return period.start <= date && date <= period.end;
}

/** epoch ms を YYYY-MM-DD に。端末の時間帯で見た日付にする(記録した本人の感覚に合わせる)。 */
function epochToDateStr(epochMs: number | undefined): string | undefined {
  if (epochMs == null || !Number.isFinite(epochMs)) return undefined;
  return toDateStr(new Date(epochMs));
}

/**
 * タスクを「いつ終わらせたか」で数えるための日付。completedAt が入っていれば
 * その日、無い古いデータ(completedAtを付ける前に完了したもの)は期限日で代用する。
 * どちらも無ければ数えない — 完了日が分からないものを今期に入れると、
 * 過去の期間を見たときに同じタスクが毎回出てしまう。
 */
export function taskCompletionDate(task: Task): string | undefined {
  if (!task.completed) return undefined;
  return epochToDateStr(task.completedAt) ?? task.dueDate;
}

export interface CategoryAmount {
  category: string;
  amount: number;
}

export interface DailyAmount {
  date: string;
  amount: number;
}

export interface ReviewSummary {
  period: ReviewPeriod;
  expenseTotal: number;
  incomeTotal: number;
  expenseCount: number;
  /** 支出の多い順。画面では上から数件だけ出す。 */
  expenseByCategory: CategoryAmount[];
  /** 期間の全日ぶん(記録が無い日も0で埋める)。棒グラフをそのまま描けるようにする。 */
  dailyExpenses: DailyAmount[];
  /** 1日あたりの支出(期間の日数で割る)。 */
  expensePerDay: number;
  tasksCompleted: number;
  eventCount: number;
  diaryCount: number;
  noteCount: number;
  /** 何か1つでも記録した日の数。「どれくらい書けたか」のざっくりした手応え。 */
  activeDays: number;
  /** 記録がまったく無い期間かどうか。画面はこれを見て空状態に切り替える。 */
  isEmpty: boolean;
}

export interface ReviewInput {
  transactions: Transaction[];
  tasks: Task[];
  events: CalendarEvent[];
  notes: Note[];
  diaryEntries: DiaryEntry[];
}

/**
 * 1つの期間ぶんを、お金・予定タスク・メモ/日記の横断でまとめる。
 *
 * 期間の絞り込みはここで全部やる(呼び出し側は全件をそのまま渡してよい) —
 * タスクの完了日は索引に載っていない completedAt から出すので、どのみち
 * JS側で見る必要があり、テーブルごとに絞り方を変えると数え漏れの元になる。
 */
export function summarizeReview(input: ReviewInput, period: ReviewPeriod): ReviewSummary {
  const days = eachDayOfInterval({ start: parseISO(period.start), end: parseISO(period.end) }).map(toDateStr);
  const activeDays = new Set<string>();

  const perDay = new Map<string, number>(days.map((day) => [day, 0]));
  const byCategory = new Map<string, number>();
  let expenseTotal = 0;
  let incomeTotal = 0;
  let expenseCount = 0;

  for (const transaction of input.transactions) {
    if (!inPeriod(transaction.date, period)) continue;
    activeDays.add(transaction.date);
    if (transaction.type === "income") {
      incomeTotal += transaction.amount;
      continue;
    }
    expenseTotal += transaction.amount;
    expenseCount += 1;
    perDay.set(transaction.date, (perDay.get(transaction.date) ?? 0) + transaction.amount);
    byCategory.set(transaction.category, (byCategory.get(transaction.category) ?? 0) + transaction.amount);
  }

  let tasksCompleted = 0;
  for (const task of input.tasks) {
    const done = taskCompletionDate(task);
    if (!inPeriod(done, period)) continue;
    tasksCompleted += 1;
    activeDays.add(done!);
  }

  let eventCount = 0;
  for (const event of input.events) {
    if (!inPeriod(event.date, period)) continue;
    eventCount += 1;
    activeDays.add(event.date);
  }

  let diaryCount = 0;
  for (const entry of input.diaryEntries) {
    if (!inPeriod(entry.date, period)) continue;
    diaryCount += 1;
    activeDays.add(entry.date);
  }

  let noteCount = 0;
  for (const note of input.notes) {
    const created = epochToDateStr(note.createdAt);
    if (!inPeriod(created, period)) continue;
    noteCount += 1;
    activeDays.add(created!);
  }

  return {
    period,
    expenseTotal,
    incomeTotal,
    expenseCount,
    expenseByCategory: [...byCategory.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    dailyExpenses: days.map((date) => ({ date, amount: perDay.get(date) ?? 0 })),
    expensePerDay: days.length > 0 ? Math.round(expenseTotal / days.length) : 0,
    tasksCompleted,
    eventCount,
    diaryCount,
    noteCount,
    activeDays: activeDays.size,
    isEmpty:
      expenseTotal === 0 &&
      incomeTotal === 0 &&
      tasksCompleted === 0 &&
      eventCount === 0 &&
      diaryCount === 0 &&
      noteCount === 0,
  };
}

export interface MonthlyAmount {
  /** YYYY-MM。 */
  month: string;
  /** 棒の下に出す文字(「8月」)。 */
  label: string;
  amount: number;
}

/** 推移グラフに並べる月数。半年ぶんあれば「増えてきている/落ち着いた」が見て取れる。 */
export const TREND_MONTHS = 6;

/**
 * 見ている月を右端にして、そこから遡った数か月ぶんの支出合計を古い順に返す。
 *
 * 記録が1件も無い月も0で埋める — 詰めて並べると、間が空いていることが
 * 分からなくなるため。月ごと表示のためのもので、週の期間を渡したときは
 * その週が入っている月を右端にする。
 */
export function monthlyExpenseTrend(
  transactions: Transaction[],
  period: ReviewPeriod,
  months: number = TREND_MONTHS,
): MonthlyAmount[] {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type === "income") continue;
    const month = transaction.date?.slice(0, 7);
    if (!month) continue;
    totals.set(month, (totals.get(month) ?? 0) + transaction.amount);
  }

  const anchor = startOfMonth(parseISO(period.start));
  const result: MonthlyAmount[] = [];
  for (let back = months - 1; back >= 0; back--) {
    const date = addMonths(anchor, -back);
    const month = format(date, "yyyy-MM");
    result.push({ month, label: format(date, "M月", { locale: ja }), amount: totals.get(month) ?? 0 });
  }
  return result;
}

/** 前の期間と比べた増減。前が0のときは割合を出さない(0からの増加は何%とも言えない)。 */
export interface ReviewDelta {
  diff: number;
  ratio: number | null;
}

export function compareToPrevious(current: number, previous: number): ReviewDelta {
  return {
    diff: current - previous,
    ratio: previous > 0 ? ((current - previous) / previous) * 100 : null,
  };
}
